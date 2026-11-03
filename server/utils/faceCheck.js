const crypto = require('crypto')
const pool = require('../db/pool')
const fileCrypto = require('./fileCrypto')

// Face checks for staff (panel review, 2026-10-26). The browser finds the face in the camera picture, waits for the head
// to turn a little and back so a still photo doesn't pass, and turns the face into 128 measurements (client/src/lib/face.js); only those numbers
// reach the server, never a picture. An account's own are kept encrypted (AES-256-GCM, FILE_ENCRYPTION_KEY) and are
// compared here. While the admin's face_check setting is on, staff with a face on record pass one at sign-in, and every
// staff member passes one before a critical action (middleware/face.middleware.js), good for FRESH_MIN minutes.

const STAFF = ['twg', 'procurement', 'supply', 'admin']
const SIZE = 128
const MATCH = 0.45       // the largest distance between two readings of one person's face (docs/face-check.md)
const STEADY = 0.35      // the largest distance of one reading from the mean of those sent with it (one face, held still)
const FRESH_MIN = 5      // minutes a passed check covers critical actions
const MAX_TRIES = 5      // checks that may fail in a row before a pause
const PAUSE_MIN = 15
const SIGN_IN_MIN = 10   // minutes a sign-in waits for its face check

const isStaff = (role) => STAFF.includes(role)

// Why a check failed, with the tries left.
const FAILED = {
  unclear: 'Your face wasn\'t clear or steady enough. Face the camera in good light and try again.',
  mismatch: 'That doesn\'t match the face on record.',
}
const failText = (result, left) => `${FAILED[result] || FAILED.mismatch} ${left} ${left === 1 ? 'try' : 'tries'} left.`

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const distance = (a, b) => Math.sqrt(a.reduce((t, v, i) => t + (v - b[i]) ** 2, 0))

// Whether face checks are in force: the admin turned them on, and the server has the key that keeps faces encrypted.
async function inForce(db = pool) {
  if (!fileCrypto.enabled()) return false
  const [[row]] = await db.execute("SELECT setting_value FROM org_settings WHERE setting_key = 'face_check'")
  return row?.setting_value === '1'
}

// The mean of the readings sent (1 to 10 lists of 128 numbers), or null when they aren't readings of one steady face.
function meanOf(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.length > 10) return null
  const bad = (s) => !Array.isArray(s) || s.length !== SIZE || s.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 2)
  if (samples.some(bad)) return null
  const mean = Array.from({ length: SIZE }, (_, i) => samples.reduce((t, s) => t + s[i], 0) / samples.length)
  return samples.every(s => distance(s, mean) <= STEADY) ? mean : null
}

// The measurements as stored: 128 floats, encrypted.
function seal(mean) {
  const buf = Buffer.alloc(SIZE * 4)
  mean.forEach((v, i) => buf.writeFloatLE(v, i * 4))
  return fileCrypto.encrypt(buf)
}

// The account's face measurements, or null when it has none on record.
async function templateOf(userId, db = pool) {
  const [[row]] = await db.execute('SELECT face_template FROM users WHERE id = ?', [userId])
  if (!row?.face_template) return null
  const buf = fileCrypto.decrypt(Buffer.from(row.face_template))
  return Array.from({ length: SIZE }, (_, i) => buf.readFloatLE(i * 4))
}

// Whether the readings sent are the account's face: 'match', 'mismatch', 'unclear' (not one steady face) or 'none'.
async function compare(userId, samples) {
  const mean = meanOf(samples)
  if (!mean) return 'unclear'
  const template = await templateOf(userId)
  if (!template) return 'none'
  return distance(mean, template) <= MATCH ? 'match' : 'mismatch'
}

// Passed checks by account and sign-in (its session key), kept in memory like the sign-in locks: a restart only means
// checking again.
const passed = new Map()
const sessionOf = (userId, sk) => `${userId}:${sk ?? ''}`
const markPassed = (userId, sk) => passed.set(sessionOf(userId, sk), Date.now())
const isFresh = (userId, sk) => Date.now() - (passed.get(sessionOf(userId, sk)) || 0) < FRESH_MIN * 60_000

// Checks that failed in a row, by account: after MAX_TRIES the account waits PAUSE_MIN minutes.
const fails = new Map()
function pausedFor(userId) {
  const f = fails.get(userId)
  return f?.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60_000) : 0
}
function recordFail(userId) {
  const f = fails.get(userId)
  const n = (f && !(f.until && f.until <= Date.now()) ? f.n : 0) + 1
  fails.set(userId, n >= MAX_TRIES ? { n, until: Date.now() + PAUSE_MIN * 60_000 } : { n })
  return Math.max(0, MAX_TRIES - n)
}

// Forgets an account's passed and failed checks, when its face is removed or replaced.
function forget(userId) {
  fails.delete(userId)
  for (const key of passed.keys()) if (key.startsWith(`${userId}:`)) passed.delete(key)
}

// Sign-ins waiting for their face check, by the SHA-256 of the ticket the browser holds: { userId, log, tries, expires }.
const signIns = new Map()
function startSignIn(userId, log = {}) {
  for (const [t, s] of signIns) if (s.userId === userId || s.expires < Date.now()) signIns.delete(t)
  const ticket = crypto.randomBytes(32).toString('hex')
  signIns.set(sha(ticket), { userId, log, tries: 0, expires: Date.now() + SIGN_IN_MIN * 60_000 })
  return ticket
}
// The waiting sign-in, or null once it expired; `drop` ends it.
function signInOf(ticket) {
  const s = signIns.get(sha(ticket ?? ''))
  if (!s || s.expires < Date.now()) { signIns.delete(sha(ticket ?? '')); return null }
  return s
}
const dropSignIn = (ticket) => signIns.delete(sha(ticket ?? ''))

module.exports = {
  STAFF, FRESH_MIN, MAX_TRIES, FAILED, failText, isStaff, inForce, meanOf, seal, templateOf, compare,
  markPassed, isFresh, pausedFor, recordFail, forget, clearFails: (userId) => fails.delete(userId),
  startSignIn, signInOf, dropSignIn,
}
