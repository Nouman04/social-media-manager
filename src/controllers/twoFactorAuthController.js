const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, Profile, Business } = require('../../models');
const { send2FACodeEmail } = require('../helpers/mailService');
const {
  signup2FASchema,
  verifyEmailSchema,
  login2FASchema,
  verify2FASchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('../validations/twoFactorAuthValidation');

const generate6DigitCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

module.exports = {
  signup2FA: async (req, res) => {
    try {
      const { error } = signup2FASchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          details: error.details.map((d) => d.message),
        });
      }

      const { name, email, password, businessName, dob } = req.body;

      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Email already registered",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const code = generate6DigitCode();
      const codeExpiry = new Date(Date.now() + 10 * 60 * 1000);

      const newUser = await User.create({
        name,
        email,
        password: hashedPassword,
        status: 'inactive',
        is_email_verified: false,
        authentication_code: code,
        code_expired_at: codeExpiry,
      });

      if (businessName) {
        const newBusiness = await Business.create({
          user_id: newUser.id,
          name: businessName,
        });
        await newUser.update({ business_id: newBusiness.id });
      }

      if (dob) {
        await Profile.create({
          user_id: newUser.id,
          dob: dob,
        });
      }

      await send2FACodeEmail(email, code, "Verify Your Email Address");

      return res.status(201).json({
        success: true,
        message: "User registered successfully. Please verify your email with the code sent.",
        user_id: newUser.id,
      });
    } catch (err) {
      console.error("[twoFactorAuthController.signup2FA] Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  },

  verifyEmail: async (req, res) => {
    try {
      const { error } = verifyEmailSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          details: error.details.map((d) => d.message),
        });
      }

      const { email, code } = req.body;
      const user = await User.findOne({ where: { email } });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.authentication_code !== code) {
        return res.status(400).json({ success: false, message: "Invalid verification code" });
      }

      if (new Date() > new Date(user.code_expired_at)) {
        return res.status(400).json({ success: false, message: "Verification code has expired" });
      }

      await user.update({
        status: 'active',
        is_email_verified: true,
        email_verified_at: new Date(),
        authentication_code: null,
        code_expired_at: null,
      });

      return res.status(200).json({
        success: true,
        message: "Email verified successfully. Account is now active.",
      });
    } catch (err) {
      console.error("[twoFactorAuthController.verifyEmail] Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  },

  login2FA: async (req, res) => {
    try {
      const { error } = login2FASchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          details: error.details.map((d) => d.message),
        });
      }

      const { email, password } = req.body;
      const user = await User.findOne({ where: { email } });

      if (!user || !user.password) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }

      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }

      const code = generate6DigitCode();
      const codeExpiry = new Date(Date.now() + 10 * 60 * 1000);

      await user.update({
        authentication_code: code,
        code_expired_at: codeExpiry,
      });

      await send2FACodeEmail(email, code, "Your Login 2FA Verification Code");

      return res.status(200).json({
        success: true,
        requires2FA: true,
        message: "Credentials matched. A 2FA code has been sent to your email address.",
      });
    } catch (err) {
      console.error("[twoFactorAuthController.login2FA] Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  },

  verify2FA: async (req, res) => {
    try {
      const { error } = verify2FASchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          details: error.details.map((d) => d.message),
        });
      }

      const { email, code } = req.body;
      const user = await User.findOne({ where: { email } });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.authentication_code !== code) {
        return res.status(400).json({ success: false, message: "Invalid 2FA verification code" });
      }

      if (new Date() > new Date(user.code_expired_at)) {
        return res.status(400).json({ success: false, message: "2FA verification code has expired" });
      }

      await user.update({
        authentication_code: null,
        code_expired_at: null,
      });

      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.NODE_SECRET_KEY || 'smm_secret_key',
        { expiresIn: '24h' }
      );

      return res.status(200).json({
        success: true,
        message: "2FA verification successful",
        token: token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
          business_id: user.business_id,
        },
      });
    } catch (err) {
      console.error("[twoFactorAuthController.verify2FA] Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  },

  forgotPassword: async (req, res) => {
    try {
      const { error } = forgotPasswordSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          details: error.details.map((d) => d.message),
        });
      }

      const { email } = req.body;
      const user = await User.findOne({ where: { email } });

      if (!user) {
        return res.status(404).json({ success: false, message: "User with this email not found" });
      }

      const code = generate6DigitCode();
      const codeExpiry = new Date(Date.now() + 10 * 60 * 1000);

      await user.update({
        authentication_code: code,
        code_expired_at: codeExpiry,
      });

      await send2FACodeEmail(email, code, "Password Reset Code");

      return res.status(200).json({
        success: true,
        message: "Password reset code sent to your email.",
      });
    } catch (err) {
      console.error("[twoFactorAuthController.forgotPassword] Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  },

  resetPassword: async (req, res) => {
    try {
      const { error } = resetPasswordSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          details: error.details.map((d) => d.message),
        });
      }

      const { email, code, newPassword } = req.body;
      const user = await User.findOne({ where: { email } });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.authentication_code !== code) {
        return res.status(400).json({ success: false, message: "Invalid reset code" });
      }

      if (new Date() > new Date(user.code_expired_at)) {
        return res.status(400).json({ success: false, message: "Reset code has expired" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await user.update({
        password: hashedPassword,
        authentication_code: null,
        code_expired_at: null,
      });

      return res.status(200).json({
        success: true,
        message: "Password reset successfully. You can now login.",
      });
    } catch (err) {
      console.error("[twoFactorAuthController.resetPassword] Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  },
};
