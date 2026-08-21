import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'

// ELISEI 5.13.9
// User-initiated phone verification through SMS.RU callcheck.
// Registration and password recovery no longer depend on an incoming call.

const { Pool } = pg
const jwtSecret = String(process.env.JWT_SECRET || '')
const databaseUrl = String(process.env.DATABASE_URL || '')
const smsRuApiId = String(process.env.SMS_RU_API_ID || '').trim()
const ownerRecoveryPhoneRaw = String(process.env.OWNER_RECOVERY_PHONE || '').trim()
const ownerRecoveryEmail = String(process.env.OWNER_RECOVERY_EMAIL || '').trim().toLowerCase()

const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined,
  max:1,
  connectionTimeoutMillis:Math.max(3000,Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000)),
  idleTimeoutMillis:15000,
}) : null

const originalPost = express.application.post
const originalGet = express.application.get

function httpError(message,status=400) { return Object.assign(new Error(message),{status}) }
function requireConfig() {
  if (!pool) throw httpError('DATABASE_URL не настроен',503)
  if (!jwtSecret) throw httpError('JWT_SECRET не настроен',503)
  if (!smsRuApiId) throw httpError('Проверка телефона звонком ещё не настроена. Добавьте SMS_RU_API_ID в Render.',503)
}
function normalizePhone(value) {
  let digits=String(value || '').replace(/\D/g,'')
  if (digits.length===11 && digits.startsWith('8')) digits=`7${digits.slice(1)}`
  if (digits.length<8 || digits.length>15) return ''
  return `+${digits}`
}
function maskPhone(value) {
  const phone=normalizePhone(value); if (!phone) return ''
  const d=phone.slice(1); return d.length<=4 ? phone : `+${d.slice(0,Math.max(1,d.length-7))}***${d.slice(-4)}`
}
function publicUser(user) {
  return { id:user.id,name:user.name,company:user.company,email:user.email,phone:user.phone || null,createdAt:user.created_at }
}
function encodeCheckId(id) { return `callcheck:${String(id || '').trim()}` }
function decodeCheckId(value) { const raw=String(value || ''); return raw.startsWith('callcheck:') ? raw.slice(10) : '' }

async function smsRu(path,params={}) {
  requireConfig()
  const query=new URLSearchParams({ api_id:smsRuApiId, json:'1', ...params })
  let response
  try {
    response=await fetch(`https://sms.ru${path}`,{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:query, signal:AbortSignal.timeout(12000) })
  } catch (cause) {
    throw Object.assign(httpError('Не удалось связаться с сервисом проверки телефона. Повторите позже.',503),{cause})
  }
  const payload=await response.json().catch(()=>({}))
  if (!response.ok || payload?.status!=='OK') {
    const detail=payload?.status_text || `HTTP ${response.status}`
    console.warn('[ELISEI CALLCHECK] provider failed:',{path,status:payload?.status || null,statusCode:payload?.status_code ?? null,detail})
    throw httpError(`Не удалось запустить проверку телефона. ${detail}`,503)
  }
  return payload
}

async function startCallcheck(phone) {
  const payload=await smsRu('/callcheck/add',{ phone:phone.replace(/^\+/,'') })
  const checkId=String(payload?.check_id || '').trim()
  const callPhone=String(payload?.call_phone || '').trim()
  const callPhonePretty=String(payload?.call_phone_pretty || payload?.call_phone_html || callPhone).trim()
  if (!checkId || !callPhone) throw httpError('SMS.RU не вернул номер для проверки. Повторите позже.',503)
  console.log('[ELISEI CALLCHECK] Verification created:',{phone:maskPhone(phone),checkId,callPhone:callPhonePretty})
  return {checkId,callPhone,callPhonePretty}
}

async function checkCallcheck(checkId) {
  const payload=await smsRu('/callcheck/status',{ check_id:checkId })
  const code=Number(payload?.check_status)
  if (code===401) return true
  if (code===400) throw httpError('Звонок пока не зафиксирован. Позвоните на показанный номер и нажмите «Проверить» ещё раз.',409)
  if (code===402) throw httpError('Время проверки истекло. Запросите новый номер для подтверждения.',400)
  throw httpError(payload?.check_status_text || 'Не удалось подтвердить звонок.',400)
}

async function assertRateLimit(table,phone) {
  const recent=await pool.query(`SELECT requested_at FROM ${table} WHERE phone=$1 AND requested_at>NOW()-INTERVAL '1 hour' ORDER BY requested_at DESC LIMIT 1`,[phone])
  if (recent.rows[0] && Date.now()-new Date(recent.rows[0].requested_at).getTime()<60000) throw httpError('Проверка уже запрошена. Новую можно начать через минуту.',429)
  const hourly=await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE phone=$1 AND requested_at>NOW()-INTERVAL '1 hour'`,[phone])
  if (Number(hourly.rows[0]?.count || 0)>=5) throw httpError('Слишком много проверок за последний час. Попробуйте позже.',429)
}

async function issueVerification({purpose,subjectKey,phone,userId=null}) {
  await assertRateLimit('phone_verification_otps',phone)
  await pool.query('UPDATE phone_verification_otps SET used_at=NOW() WHERE purpose=$1 AND subject_key=$2 AND used_at IS NULL',[purpose,subjectKey])
  const check=await startCallcheck(phone)
  const id=crypto.randomUUID()
  await pool.query(`INSERT INTO phone_verification_otps (id,user_id,purpose,subject_key,phone,code_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '5 minutes')`,[id,userId,purpose,subjectKey,phone,encodeCheckId(check.checkId)])
  return {...check,expiresInMinutes:5}
}

async function confirmVerification({purpose,subjectKey,phone,userId=null}) {
  const params=[purpose,subjectKey,phone]; let userFilter=''
  if (userId) { params.push(userId); userFilter=` AND user_id=$${params.length}` }
  const found=await pool.query(`SELECT id,code_hash,expires_at FROM phone_verification_otps WHERE purpose=$1 AND subject_key=$2 AND phone=$3 AND used_at IS NULL${userFilter} ORDER BY requested_at DESC LIMIT 1`,params)
  const row=found.rows[0]
  if (!row || new Date(row.expires_at).getTime()<Date.now()) throw httpError('Время проверки истекло. Запросите новый номер.',400)
  const checkId=decodeCheckId(row.code_hash)
  if (!checkId) throw httpError('Эта проверка относится к старому способу подтверждения. Запросите новую.',400)
  await checkCallcheck(checkId)
  await pool.query('UPDATE phone_verification_otps SET used_at=NOW() WHERE id=$1',[row.id])
}

async function resolvePasswordResetUser(phone,requestedEmail='') {
  const email=String(requestedEmail || '').trim().toLowerCase()
  const direct=await pool.query(`SELECT id,email,phone,password_hash FROM users WHERE phone=$1 AND ($2::text='' OR email=$2) LIMIT 1`,[phone,email])
  if (direct.rows[0]) return {user:direct.rows[0],bootstrap:false}
  const ownerPhone=normalizePhone(ownerRecoveryPhoneRaw)
  if (!ownerPhone || ownerPhone!==phone) return {user:null,bootstrap:false}
  const bootstrapEmail=email || ownerRecoveryEmail
  if (bootstrapEmail) {
    const byEmail=await pool.query(`SELECT id,email,phone,password_hash FROM users WHERE email=$1 AND (phone IS NULL OR phone=$2) LIMIT 1`,[bootstrapEmail,phone])
    return {user:byEmail.rows[0] || null,bootstrap:Boolean(byEmail.rows[0])}
  }
  const only=await pool.query('SELECT id,email,phone,password_hash FROM users WHERE phone IS NULL ORDER BY created_at ASC LIMIT 2')
  return {user:only.rowCount===1 ? only.rows[0] : null,bootstrap:only.rowCount===1}
}

async function issuePasswordReset({user,phone}) {
  await assertRateLimit('password_reset_otps',phone)
  await pool.query('UPDATE password_reset_otps SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[user.id])
  const check=await startCallcheck(phone)
  const id=crypto.randomUUID()
  await pool.query(`INSERT INTO password_reset_otps (id,user_id,phone,code_hash,expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')`,[id,user.id,phone,encodeCheckId(check.checkId)])
  return {...check,expiresInMinutes:5}
}

async function confirmPasswordReset({phone}) {
  const found=await pool.query(`SELECT id,user_id,code_hash,expires_at FROM password_reset_otps WHERE phone=$1 AND used_at IS NULL ORDER BY requested_at DESC LIMIT 1`,[phone])
  const row=found.rows[0]
  if (!row || new Date(row.expires_at).getTime()<Date.now()) throw httpError('Время проверки истекло. Запросите новый номер.',400)
  const checkId=decodeCheckId(row.code_hash)
  if (!checkId) throw httpError('Эта проверка относится к старому способу подтверждения. Запросите новую.',400)
  await checkCallcheck(checkId)
  return row
}

async function registerPhoneRequest(req,res) {
  try {
    requireConfig()
    const email=String(req.body?.email || '').trim().toLowerCase(); const phone=normalizePhone(req.body?.phone)
    if (!email.includes('@') || !phone) return res.status(400).json({error:'Введите корректную почту и номер телефона.'})
    const existing=await pool.query('SELECT id FROM users WHERE email=$1 OR phone=$2 LIMIT 1',[email,phone])
    if (existing.rowCount) return res.status(409).json({error:'Аккаунт с такой почтой или телефоном уже существует'})
    const issued=await issueVerification({purpose:'register',subjectKey:email,phone})
    return res.json({ok:true,verificationMethod:'user_call_check',expiresInMinutes:5,phoneMasked:maskPhone(phone),callPhone:issued.callPhone,callPhonePretty:issued.callPhonePretty,message:`Позвоните со своего телефона на ${issued.callPhonePretty}. Сервис автоматически сбросит звонок.`})
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

async function registerPhoneConfirm(req,res) {
  try {
    requireConfig()
    const email=String(req.body?.email || '').trim().toLowerCase(); const phone=normalizePhone(req.body?.phone)
    if (!email.includes('@') || !phone) return res.status(400).json({error:'Введите почту и телефон.'})
    await confirmVerification({purpose:'register',subjectKey:email,phone})
    const verificationToken=jwt.sign({purpose:'register_phone',email,phone},jwtSecret,{expiresIn:'10m'})
    return res.json({ok:true,verificationToken,phoneMasked:maskPhone(phone),verificationMethod:'user_call_check',message:'Телефон подтверждён.'})
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

async function passwordResetRequest(req,res) {
  try {
    requireConfig()
    const phone=normalizePhone(req.body?.phone); const email=String(req.body?.email || '').trim().toLowerCase()
    if (!phone || !email.includes('@')) return res.status(400).json({error:'Введите почту старого аккаунта и корректный телефон.'})
    const resolved=await resolvePasswordResetUser(phone,email)
    if (!resolved.user) return res.status(404).json({error:'Не удалось найти аккаунт с такими данными.'})
    const issued=await issuePasswordReset({user:resolved.user,phone})
    console.log(`[ELISEI CALLCHECK RESET] Started for ${maskPhone(phone)}${resolved.bootstrap ? ' (legacy owner bootstrap)' : ''}`)
    return res.json({ok:true,verificationMethod:'user_call_check',expiresInMinutes:5,callPhone:issued.callPhone,callPhonePretty:issued.callPhonePretty,message:`Позвоните со своего номера на ${issued.callPhonePretty}. Вызов будет автоматически сброшен.`})
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

async function passwordResetConfirm(req,res) {
  try {
    requireConfig()
    const phone=normalizePhone(req.body?.phone); const password=String(req.body?.password || '')
    if (!phone) return res.status(400).json({error:'Введите номер телефона.'})
    if (password.length<8) return res.status(400).json({error:'Новый пароль должен содержать минимум 8 символов.'})
    const otp=await confirmPasswordReset({phone})
    const passwordHash=await bcrypt.hash(password,12)
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      const updated=await client.query('UPDATE users SET password_hash=$1,phone=COALESCE(phone,$2) WHERE id=$3 RETURNING email',[passwordHash,phone,otp.user_id])
      await client.query('UPDATE password_reset_otps SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[otp.user_id])
      await client.query('COMMIT')
      return res.json({ok:true,message:'Телефон подтверждён, пароль изменён. Теперь войдите с новым паролем.',loginEmail:updated.rows[0]?.email || ''})
    } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error } finally { client.release() }
  } catch (error) { return res.status(error.status || 500).json({error:error.message}) }
}

const routeOverrides=new Map([
  ['/api/auth/register/phone/request',[registerPhoneRequest]],
  ['/api/auth/register/phone/confirm',[registerPhoneConfirm]],
  ['/api/auth/password-reset/sms/request',[passwordResetRequest]],
  ['/api/auth/password-reset/sms/confirm',[passwordResetConfirm]],
])

express.application.post=function patchedPost(path,...handlers) {
  const replacement=routeOverrides.get(String(path))
  if (replacement) return originalPost.call(this,path,...replacement)
  return originalPost.call(this,path,...handlers)
}

express.application.get=function patchedGet(path,...handlers) {
  if (String(path)==='/health' && handlers.length) {
    const last=handlers.at(-1); const before=handlers.slice(0,-1)
    const wrapped=async (req,res,next) => {
      const json=res.json.bind(res)
      res.json=payload => json({...payload,version:'2.25.9',authRecovery:{...(payload?.authRecovery || {}),mode:'user_call_check',provider:'sms.ru/callcheck',callReady:Boolean(smsRuApiId),smsReady:false}})
      return last(req,res,next)
    }
    return originalGet.call(this,path,...before,wrapped)
  }
  return originalGet.call(this,path,...handlers)
}

console.log('[ELISEI 5.13.9] Phone verification transport: SMS.RU callcheck (user initiated)')
