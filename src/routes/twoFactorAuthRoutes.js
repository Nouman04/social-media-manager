const express = require('express');
const router = express.Router();
const twoFactorAuthController = require('../controllers/twoFactorAuthController');

router.post('/signup', twoFactorAuthController.signup2FA);
router.post('/verify-email', twoFactorAuthController.verifyEmail);
router.post('/login', twoFactorAuthController.login2FA);
router.post('/verify-2fa', twoFactorAuthController.verify2FA);
router.post('/forgot-password', twoFactorAuthController.forgotPassword);
router.post('/reset-password', twoFactorAuthController.resetPassword);

module.exports = router;
