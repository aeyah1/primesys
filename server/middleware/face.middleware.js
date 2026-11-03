const face = require('../utils/faceCheck')

const NEEDED = 'Confirm it\'s you with a face check first.'
const SET_UP = 'Set up your face check in Settings, Security first.'

// Critical actions (panel review): while face checks are on, a staff member must have passed one in the last few
// minutes. Refused with 428 and type 'face', which the app answers by opening the camera and sending the action again.
// Put it after the route's validation, so a form with mistakes is corrected before the camera opens.
async function requireFace(req, res, next) {
  try {
    if (!face.isStaff(req.user.role) || !await face.inForce() || face.isFresh(req.user.id, req.user.sk)) return next()
    const enrolled = !!await face.templateOf(req.user.id)
    res.status(428).json({ type: 'face', enrolled, message: enrolled ? NEEDED : SET_UP })
  } catch (err) { next(err) }
}

// The same, only for requests `test` picks (e.g. a status change to cancelled).
requireFace.when = (test) => (req, res, next) => (test(req) ? requireFace(req, res, next) : next())

module.exports = requireFace
