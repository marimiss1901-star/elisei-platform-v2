import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'

// ELISEI 5.13.8
//
// Compatibility layer for the 5.13.7 auth routes. The public route names stay
// unchanged so already deployed frontends keep working, while their transport
// is switched from SMS to SMS.RU code/call. SMS.RU calls the user and returns
// the final four digits of the caller number to the backend. Only a HMAC of
// those four digits is persisted in ELISEI.

const { Pool } = pg
const jwtSecret = String(process.env.JWT_SECRET || '')
const databaseUrl = String(process.env.DATABASE_URL || '')
const smsRuApiId = String(process.env.SMS_RU_API_ID || '').trim()
const ownerRecoveryPhoneRaw = String(process.env.OWNER_RECOVERY_PHONE || '').trim()
const ownerRecoveryEmail = String(process.env.OWNER_RECOVERY_EMAIL || '').trim().toLowerCase()

const pool = databaseUrl ? new Pool({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined,
  max:1,
  connectionTimeoutMillis:Math.max(3000,Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000)),
  idleTimeoutMillis:15000,
}) : null

const originalPost = express.application.post
const originalGet = express.application.get

function httpError(message,status=400) {
  return Object.assign(new Error(message),{status})
}

function requireCallAuthConfig() {
  if (!pool) throw httpError('DATABASE_URL не настроен',503)
  if (!jwtSecret) throw httpError('JWT_SECRET не настроен',503)
  if (!smsRuApiId) throw httpError('Подтверждение телефона звонком ещё не настроено. Добавьте SMS_RU_API_ID в Render.',503)
}

function normalizePhone(value) {
  const raw=String(value || '').trim()
  if (!raw) return ''
  let digits=raw.replace(/\D/g,'')
  if (digits.length === 11 && digits.startsWith('8')) digits=`7${digits.slice(1)}`
  if (digits.length < 8 || digits.length > 15) return ''
  return `+${digits}`
}

function maskPhone(value) {
  const phone=normalizePhone(value)
  if (!phone) return ''
  const digits=phone.slice(1)
  if (digits.length <= 4) return phone
  return `+${digits.slice(0,Math.max(1,digits.length-7))}***${digits.slice(-4)}`
}

function safeEqualHex(leftValue,rightValue) {
  try {
    const left=Buffer.from(String(leftValue || ''),'hex')
    const right=Buffer.from(String(rightValue || ''),'hex')
    return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left,right)
  } catch { return false }
}

function phoneVerificationHash({purpose,subjectKey,phone,code}) {
  return crypto.createHmac('sha256',jwtSecret).update(`${purpose}:${subjectKey}:${phone}:${code}`).digest('hex')
}

function resetHash({userId,phone,code}) {
  return crypto.createHmac('sha256',jwtSecret).update(`${userId}:${phone}:${code}`).digest('hex')
}

function requestIp(req) {
  const forwarded=String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  const raw=forwarded || String(req.socket?.remoteAddress || req.ip || '').trim()
  const cleaned=raw.replace(/^::ffff:/,'')
  return cleaned && cleaned !== '::1' ? cleaned : '-1'
}

function publicUser(user) {
  return {
    id:user.id,
    name:user.name,
    company:user.company,
    email:user.email,
    phone:user.phone || null,
    createdAt:user.created_at,
  }
}

async function startCodeCall(phone,ip) {
  requireCallAuthConfig()
  const params=new URLSearchParams({
    api_id:smsRuApiId,
    phone:phone.replace(/^\+/,''),
    ip:ip || '-1',
  })
  let response
  try {
    response=await fetch('https://sms.ru/code/call',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:params,
      signal:AbortSignal.timeout(12000),
    })
  } catch (cause) {
    throw Object.assign(httpError('Не удалось запустить звонок подтверждения. Повторите позже.',503),{cause})
  }
  const payload=await response.json().catch(()=>({}))
  const code=String(payload?.code || '').replace(/\D/g,'')
  if (!response.ok || payload?.status !== 'OK' || code.length !== 4) {
    const detail=payload?.status_text || `HTTP ${response.status}`
    console.warn('[ELISEI CALL VERIFY] SMS.RU code/call failed:',{
      status:payload?.status || null,
      statusCode:payload?.status_code ?? null,
      detail,
    })
    throw httpError(`Не удалось выполнить звонок подтверждения. ${detail}`,503)
  }
  console.log('[ELISEI CALL VERIFY] Call started:',{
    phone:maskPhone(phone),
    callId:payload?.call_id || null,
    cost:payload?.cost ?? null,
  })
  return { code,callId:payload?.call_id || null,cost:payload?.cost ?? null }
}

async function assertPhoneRateLimit(table,phone) {
  const recent=await pool.query(
    `SELECT requested_at FROM ${table} WHERE phone=$1 AND requested_at>NOW()-INTERVAL '1 hour' ORDER BY requested_at DESC LIMIT 1`,
    [phone]
  )
  if (recent.rows[0] && Date.now()-new Date(recent.rows[0].requested_at).getTime()<60000) {
    throw httpError('Звонок уже запрошен. Повторная проверка будет доступна через минуту.',429)
  }
  const hourly=await pool.query(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE phone=$1 AND requested_at>NOW()-INTERVAL '1 hour'`,
    [phone]
  )
  if (Number(hourly.rows[0]?.count || 0)>=5) throw httpError('Слишком много проверок за последний час. Попробуйте позже.',429)
}

async function issuePhoneVerification({purpose,subjectKey,phone,userId=null,req}) {
  requireCallAuthConfig()
  await assertPhoneRateLimit('phone_verification_otps',phone)
  await pool.query(
    'UPDATE phone_verification_otps SET used_at=NOW() WHERE purpose=$1 AND subject_key=$2 AND used_at IS NULL',
    [purpose,subjectKey]
  )
  const call=await startCodeCall(phone,requestIp(req))
  const id=crypto.randomUUID()
  const codeHash=phoneVerificationHash({purpose,subjectKey,phone,code:call.code})
  await pool.query(
    `INSERT INTO phone_verification_otps (id,user_id,purpose,subject_key,phone,code_hash,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '5 minutes')`,
    [id,userId,purpose,subjectKey,phone,codeHash]
  )
  return { id,expiresInMinutes:5,callId:call.callId }
}

async function consumePhoneVerification({purpose,subjectKey,phone,code,userId=null}) {
  const params=[purpose,subjectKey,phone]
  let userFilter=''
  if (userId) {
    params.push(userId)
    userFilter=` AND user_id=$${params.length}`
  }
  const found=await pool.query(
    `SELECT id,code_hash,attempts,expires_at FROM phone_verification_otps
     WHERE purpose=$1 AND subject_key=$2 AND phone=$3 AND used_at IS NULL${userFilter}
     ORDER BY requested_at DESC LIMIT 1`,
    params
  )
  const otp=found.rows[0]
  if (!otp || new Date(otp.expires_at).getTime()<Date.now()) {
    if (otp) await pool.query('UPDATE phone_verification_otps SET used_at=NOW() WHERE id=$1',[otp.id])
    throw httpError('Код звонка истёк. Запросите новый звонок.',400)
  }
  if (Number(otp.attempts || 0)>=5) {
    await pool.query('UPDATE phone_verification_otps SET used_at=NOW() WHERE id=$1',[otp.id])
    throw httpError('Слишком много попыток. Запросите новый звонок.',429)
  }
  const expected=phoneVerificationHash({purpose,subjectKey,phone,code})
  if (!safeEqualHex(expected,otp.code_hash)) {
    const next=Number(otp.attempts || 0)+1
    await pool.query(
      'UPDATE phone_verification_otps SET attempts=$2,used_at=CASE WHEN $2>=5 THEN NOW() ELSE used_at END WHERE id=$1',
      [otp.id,next]
    )
    throw httpError('Неверные цифры. Введите последние 4 цифры номера входящего звонка.',400)
  }
  await pool.query('UPDATE phone_verification_otps SET used_at=NOW() WHERE id=$1',[otp.id])
}

async function resolvePasswordResetUser(phone,requestedEmail='') {
  const email=String(requestedEmail || '').trim().toLowerCase()
  const direct=await pool.query(
    `SELECT id,email,phone,password_hash FROM users
     WHERE phone=$1 AND ($2::text='' OR email=$2) LIMIT 1`,
    [phone,email]
  )
  if (direct.rows[0]) return {user:direct.rows[0],bootstrap:false}

  const ownerPhone=normalizePhone(ownerRecoveryPhoneRaw)
  if (!ownerPhone || ownerPhone!==phone) return {user:null,bootstrap:false}

  // Legacy owner account: it may have been created before ELISEI stored phones.
  // Prefer an email supplied by the owner at recovery time, then the configured
  // fallback. In both cases never overwrite a different already verified phone.
  const bootstrapEmail=email || ownerRecoveryEmail
  if (bootstrapEmail) {
    const byEmail=await pool.query(
      `SELECT id,email,phone,password_hash FROM users
       WHERE email=$1 AND (phone IS NULL OR phone=$2) LIMIT 1`,
      [bootstrapEmail,phone]
    )
    return {user:byEmail.rows[0] || null,bootstrap:Boolean(byEmail.rows[0])}
  }
  const only=await pool.query(
    'SELECT id,email,phone,password_hash FROM users WHERE phone IS NULL ORDER BY created_at ASC LIMIT 2'
  )
  return {user:only.rowCount===1 ? only.rows[0] : null,bootstrap:only.rowCount===1}
}

async function issuePasswordReset({user,phone,req}) {
  requireCallAuthConfig()
  await assertPhoneRateLimit('password_reset_otps',phone)
  await pool.query('UPDATE password_reset_otps SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[user.id])
  const call=await startCodeCall(phone,requestIp(req))
  const id=crypto.randomUUID()
  const codeHash=resetHash({userId:user.id,phone,code:call.code})
  await pool.query(
    `INSERT INTO password_reset_otps (id,user_id,phone,code_hash,expires_at)
     VALUES ($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')`,
    [id,user.id,phone,codeHash]
  )
  return {id,callId:call.callId}
}

async function consumePasswordReset({phone,code}) {
  const found=await pool.query(
    `SELECT id,user_id,code_hash,attempts,expires_at FROM password_reset_otps
     WHERE phone=$1 AND used_at IS NULL ORDER BY requested_at DESC LIMIT 1`,
    [phone]
  )
  const otp=found.rows[0]
  if (!otp || new Date(otp.expires_at).getTime()<Date.now()) {
    if (otp) await pool.query('UPDATE password_reset_otps SET used_at=NOW() WHERE id=$1',[otp.id])
    throw httpError('Код звонка истёк. Запросите новый звонок.',400)
  }
  if (Number(otp.attempts || 0)>=5) {
    await pool.query('UPDATE password_reset_otps SET used_at=NOW() WHERE id=$1',[otp.id])
    throw httpError('Слишком много попыток. Запросите новый звонок.',429)
  }
  const expected=resetHash({userId:otp.user_id,phone,code})
  if (!safeEqualHex(expected,otp.code_hash)) {
    const next=Number(otp.attempts || 0)+1
    await pool.query(
      'UPDATE password_reset_otps SET attempts=$2,used_at=CASE WHEN $2>=5 THEN NOW() ELSE used_at END WHERE id=$1',
      [otp.id,next]
    )
    throw httpError('Неверные цифры. Введите последние 4 цифры номера входящего звонка.',400)
  }
  return otp
}

function authRequired(req,res,next) {
  try {
    if (!jwtSecret) throw httpError('JWT_SECRET не настроен',503)
    const value=String(req.headers.authorization || '')
    const token=value.startsWith('Bearer ') ? value.slice(7) : ''
    if (!token) return res.status(401).json({error:'Требуется авторизация'})
    req.auth=jwt.verify(token,jwtSecret)
    next()
  } catch (error) {
    return res.status(error.status || 401).json({error:error.status ? error.message : 'Сессия истекла. Войдите снова.'})
  }
}

const callHint='Сейчас вам поступит входящий звонок. Отвечать не нужно: запомните последние 4 цифры номера, с которого звонят.'

async function registerPhoneRequest(req,res) {
  try {
    requireCallAuthConfig()
    const email=String(req.body?.email || '').trim().toLowerCase()
    const phone=normalizePhone(req.body?.phone)
    if (!email.includes('@') || !phone) return res.status(400).json({error:'Введите корректную почту и номер телефона с кодом страны.'})
    const existing=await pool.query('SELECT id FROM users WHERE email=$1 OR phone=$2 LIMIT 1',[email,phone])
    if (existing.rowCount) return res.status(409).json({error:'Аккаунт с такой почтой или телефоном уже существует'})
    const issued=await issuePhoneVerification({purpose:'register',subjectKey:email,phone,req})
    return res.json({ok:true,expiresInMinutes:issued.expiresInMinutes,phoneMasked:maskPhone(phone),verificationMethod:'phone_call_code',message:callHint})
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

async function registerPhoneConfirm(req,res) {
  try {
    requireCallAuthConfig()
    const email=String(req.body?.email || '').trim().toLowerCase()
    const phone=normalizePhone(req.body?.phone)
    const code=String(req.body?.code || '').replace(/\D/g,'')
    if (!email.includes('@') || !phone || code.length!==4) return res.status(400).json({error:'Введите почту, телефон и последние 4 цифры номера входящего звонка.'})
    await consumePhoneVerification({purpose:'register',subjectKey:email,phone,code})
    const verificationToken=jwt.sign({purpose:'register_phone',email,phone},jwtSecret,{expiresIn:'10m'})
    return res.json({ok:true,verificationToken,phoneMasked:maskPhone(phone),verificationMethod:'phone_call_code',message:'Телефон подтверждён.'})
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

async function passwordResetRequest(req,res) {
  const generic={
    ok:true,
    verificationMethod:'phone_call_code',
    expiresInMinutes:5,
    message:`Если данные относятся к аккаунту ELISEI, ${callHint.toLowerCase()}`,
  }
  try {
    requireCallAuthConfig()
    const phone=normalizePhone(req.body?.phone)
    const email=String(req.body?.email || '').trim().toLowerCase()
    if (!phone) return res.status(400).json({error:'Введите корректный номер телефона с кодом страны.'})
    const resolved=await resolvePasswordResetUser(phone,email)
    if (!resolved.user) return res.json(generic)
    await issuePasswordReset({user:resolved.user,phone,req})
    console.log(`[ELISEI CALL RESET] Recovery call started for ${maskPhone(phone)}${resolved.bootstrap ? ' (legacy owner bootstrap)' : ''}`)
    return res.json(generic)
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

async function passwordResetConfirm(req,res) {
  try {
    requireCallAuthConfig()
    const phone=normalizePhone(req.body?.phone)
    const code=String(req.body?.code || '').replace(/\D/g,'')
    const password=String(req.body?.password || '')
    if (!phone || code.length!==4) return res.status(400).json({error:'Введите номер телефона и последние 4 цифры номера входящего звонка.'})
    if (password.length<8) return res.status(400).json({error:'Новый пароль должен содержать минимум 8 символов.'})
    const otp=await consumePasswordReset({phone,code})
    const passwordHash=await bcrypt.hash(password,12)
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      const updated=await client.query(
        'UPDATE users SET password_hash=$1,phone=COALESCE(phone,$2) WHERE id=$3 RETURNING email',
        [passwordHash,phone,otp.user_id]
      )
      await client.query('UPDATE password_reset_otps SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[otp.user_id])
      await client.query('COMMIT')
      return res.json({ok:true,message:'Пароль изменён. Теперь войдите с новым паролем.',loginEmail:updated.rows[0]?.email || ''})
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>{})
      throw error
    } finally { client.release() }
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

async function phoneChangeRequest(req,res) {
  try {
    requireCallAuthConfig()
    const phone=normalizePhone(req.body?.phone)
    if (!phone) return res.status(400).json({error:'Введите корректный номер телефона с кодом страны.'})
    const occupied=await pool.query('SELECT id FROM users WHERE phone=$1 AND id<>$2 LIMIT 1',[phone,req.auth.sub])
    if (occupied.rowCount) return res.status(409).json({error:'Этот номер уже используется другим аккаунтом.'})
    const issued=await issuePhoneVerification({purpose:'profile',subjectKey:req.auth.sub,phone,userId:req.auth.sub,req})
    return res.json({ok:true,expiresInMinutes:issued.expiresInMinutes,phoneMasked:maskPhone(phone),verificationMethod:'phone_call_code',message:callHint})
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

async function phoneChangeConfirm(req,res) {
  try {
    requireCallAuthConfig()
    const phone=normalizePhone(req.body?.phone)
    const code=String(req.body?.code || '').replace(/\D/g,'')
    if (!phone || code.length!==4) return res.status(400).json({error:'Введите номер и последние 4 цифры номера входящего звонка.'})
    const occupied=await pool.query('SELECT id FROM users WHERE phone=$1 AND id<>$2 LIMIT 1',[phone,req.auth.sub])
    if (occupied.rowCount) return res.status(409).json({error:'Этот номер уже используется другим аккаунтом.'})
    await consumePhoneVerification({purpose:'profile',subjectKey:req.auth.sub,phone,code,userId:req.auth.sub})
    const updated=await pool.query(
      'UPDATE users SET phone=$1 WHERE id=$2 RETURNING id,name,company,email,phone,created_at',
      [phone,req.auth.sub]
    )
    if (!updated.rows[0]) return res.status(404).json({error:'Пользователь не найден'})
    return res.json({ok:true,user:publicUser(updated.rows[0]),message:'Телефон подтверждён и сохранён.'})
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

const routeOverrides=new Map([
  ['/api/auth/register/phone/request',[registerPhoneRequest]],
  ['/api/auth/register/phone/confirm',[registerPhoneConfirm]],
  ['/api/auth/password-reset/sms/request',[passwordResetRequest]],
  ['/api/auth/password-reset/sms/confirm',[passwordResetConfirm]],
  ['/api/auth/phone/request',[authRequired,phoneChangeRequest]],
  ['/api/auth/phone/confirm',[authRequired,phoneChangeConfirm]],
])

express.application.post=function patchedPost(path,...handlers) {
  const replacement=routeOverrides.get(String(path))
  if (replacement) return originalPost.call(this,path,...replacement)
  return originalPost.call(this,path,...handlers)
}

express.application.get=function patchedGet(path,...handlers) {
  if (String(path)==='/health' && handlers.length) {
    const last=handlers.at(-1)
    const before=handlers.slice(0,-1)
    const wrapped=async (req,res,next) => {
      const json=res.json.bind(res)
      res.json=payload => json({
        ...payload,
        version:'2.25.8',
        authRecovery:{
          ...(payload?.authRecovery || {}),
          mode:'phone_call_code',
          provider:'sms.ru/code/call',
          callReady:Boolean(smsRuApiId),
          smsReady:false,
          otpDigits:4,
        },
      })
      return last(req,res,next)
    }
    return originalGet.call(this,path,...before,wrapped)
  }
  return originalGet.call(this,path,...handlers)
}

console.log('[ELISEI 5.13.8] Phone verification transport: SMS.RU code/call')
