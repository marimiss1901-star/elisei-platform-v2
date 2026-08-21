import 'dotenv/config'
import express from 'express'
import pg from 'pg'

// Temporary safe diagnostics for legacy owner password recovery.
// Logs booleans only: no password hashes, API ids, or full environment secrets.
const { Pool } = pg
const databaseUrl = String(process.env.DATABASE_URL || '')
const ownerRecoveryPhoneRaw = String(process.env.OWNER_RECOVERY_PHONE || '').trim()
const pool = databaseUrl ? new Pool({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined,
  max:1,
  connectionTimeoutMillis:Math.max(3000,Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000)),
  idleTimeoutMillis:15000,
}) : null

function normalizePhone(value) {
  let digits=String(value || '').replace(/\D/g,'')
  if (digits.length===11 && digits.startsWith('8')) digits=`7${digits.slice(1)}`
  if (digits.length<8 || digits.length>15) return ''
  return `+${digits}`
}

const inheritedPost = express.application.post

express.application.post = function diagnosticPost(path,...handlers) {
  if (String(path)==='/api/auth/password-reset/sms/request') {
    const diagnostic = async (req,_res,next) => {
      try {
        const email=String(req.body?.email || '').trim().toLowerCase()
        const phone=normalizePhone(req.body?.phone)
        const ownerPhone=normalizePhone(ownerRecoveryPhoneRaw)
        let emailExists=false
        let storedPhoneMissing=false
        let storedPhoneMatches=false
        let storedPhoneDifferent=false
        if (pool && email.includes('@')) {
          const result=await pool.query('SELECT phone FROM users WHERE email=$1 LIMIT 1',[email])
          emailExists=Boolean(result.rows[0])
          if (result.rows[0]) {
            const stored=normalizePhone(result.rows[0].phone)
            storedPhoneMissing=!stored
            storedPhoneMatches=Boolean(stored && phone && stored===phone)
            storedPhoneDifferent=Boolean(stored && phone && stored!==phone)
          }
        }
        console.log('[ELISEI LEGACY RECOVERY DIAG]',{
          emailExists,
          storedPhoneMissing,
          storedPhoneMatches,
          storedPhoneDifferent,
          ownerRecoveryPhoneConfigured:Boolean(ownerPhone),
          requestedPhoneMatchesOwner:Boolean(phone && ownerPhone && phone===ownerPhone),
        })
      } catch (error) {
        console.warn('[ELISEI LEGACY RECOVERY DIAG] failed:',error.message)
      }
      next()
    }
    return inheritedPost.call(this,path,diagnostic,...handlers)
  }
  return inheritedPost.call(this,path,...handlers)
}

console.log('[ELISEI] Legacy recovery diagnostics enabled')
