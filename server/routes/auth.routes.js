const router = require('express').Router()
const { register, login, me, updateProfile, changePassword, forgotPassword, resetPassword, verifyEmail, resendVerification } = require('../controllers/auth.controller')
const auth = require('../middleware/auth.middleware')

router.post('/register',             register)
router.post('/login',                login)
router.post('/forgot-password',      forgotPassword)
router.post('/reset-password',       resetPassword)
router.post('/verify-email',         verifyEmail)
router.post('/resend-verification',  resendVerification)
router.get('/me',                    auth, me)
router.patch('/me',                  auth, updateProfile)
router.patch('/password',            auth, changePassword)

module.exports = router
