const bcrypt = require('bcryptjs')
const pool = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const face = require('../utils/faceCheck')
const fileCrypto = require('../utils/fileCrypto')
const securityLog = require('../utils/securityLog')

const paused = (min) => `Too many face checks didn't match. Try again in ${min} minute${min === 1 ? '' : 's'}.`

// GET /auth/face - this account's face check: whether it is staff, whether checks are on, when its face was set up.
exports.status = asyncHandler(async (req, res) => {
  const [[row]] = await pool.execute('SELECT face_enrolled_at FROM users WHERE id = ?', [req.user.id])
  res.json({
    staff: face.isStaff(req.user.role),
    in_force: face.isStaff(req.user.role) && await face.inForce(),
    enrolled_at: row?.face_enrolled_at ?? null,
    can_enrol: fileCrypto.enabled(),
  })
})

// PUT /auth/face - { samples, password, consent: true }: sets up (or replaces) this staff member's face check. Replacing
// one while checks are on takes a passed check with the face on record first.
exports.enrol = asyncHandler(async (req, res) => {
  if (!fileCrypto.enabled()) {
    return res.status(503).json({ message: 'Face checks can\'t be set up yet: the server has no key to keep faces encrypted. Tell your administrator.' })
  }
  const [[user]] = await pool.execute('SELECT password_hash, face_enrolled_at FROM users WHERE id = ?', [req.user.id])
  if (!user || !await bcrypt.compare(req.body.password, user.password_hash)) return res.status(401).json({ message: 'Your password isn\'t right.' })
  if (user.face_enrolled_at && await face.inForce() && !face.isFresh(req.user.id, req.user.sk)) {
    return res.status(428).json({ type: 'face', enrolled: true, message: 'Confirm it\'s you with your current face first.' })
  }
  const mean = face.meanOf(req.body.samples)
  if (!mean) return res.status(400).json({ message: face.FAILED.unclear })
  await pool.execute('UPDATE users SET face_template = ?, face_enrolled_at = NOW() WHERE id = ?', [face.seal(mean), req.user.id])
  face.forget(req.user.id)
  face.markPassed(req.user.id, req.user.sk)
  securityLog(user.face_enrolled_at ? 'face_replaced' : 'face_enrolled', { userId: req.user.id, ip: req.ip })
  res.json({ message: 'Face check set up' })
})

// DELETE /auth/face - removes this account's face measurements (withdrawing consent); the route asks for a check first.
exports.remove = asyncHandler(async (req, res) => {
  const [r] = await pool.execute('UPDATE users SET face_template = NULL, face_enrolled_at = NULL WHERE id = ? AND face_template IS NOT NULL', [req.user.id])
  face.forget(req.user.id)
  if (r.affectedRows) securityLog('face_removed', { userId: req.user.id, ip: req.ip })
  res.json({ message: 'Face check removed' })
})

// POST /auth/face/check - { samples }: a check before critical actions; passed, it covers them for a few minutes.
exports.check = asyncHandler(async (req, res) => {
  const wait = face.pausedFor(req.user.id)
  if (wait) return res.status(429).json({ message: paused(wait) })
  const result = await face.compare(req.user.id, req.body.samples)
  if (result === 'none') return res.status(400).json({ message: 'Set up your face check in Settings, Security first.', type: 'none' })
  if (result !== 'match') {
    const left = face.recordFail(req.user.id)
    securityLog('face_check_failed', { userId: req.user.id, ip: req.ip, reason: result })
    if (!left) return res.status(429).json({ message: paused(face.pausedFor(req.user.id)) })
    return res.status(400).json({ message: face.failText(result, left), left })
  }
  face.clearFails(req.user.id)
  face.markPassed(req.user.id, req.user.sk)
  securityLog('face_check', { userId: req.user.id, ip: req.ip })
  res.json({ message: 'Face check passed', minutes: face.FRESH_MIN })
})
