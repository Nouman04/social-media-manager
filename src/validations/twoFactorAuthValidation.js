const Joi = require("joi");

const signup2FASchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().email().trim().required(),
  password: Joi.string().min(6).required(),
  businessName: Joi.string().trim().optional(),
  dob: Joi.date().iso().optional(),
});

const verifyEmailSchema = Joi.object({
  email: Joi.string().email().trim().required(),
  code: Joi.string().trim().required(),
});

const login2FASchema = Joi.object({
  email: Joi.string().email().trim().required(),
  password: Joi.string().required(),
});

const verify2FASchema = Joi.object({
  email: Joi.string().email().trim().required(),
  code: Joi.string().trim().required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().trim().required(),
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().trim().required(),
  code: Joi.string().trim().required(),
  newPassword: Joi.string().min(6).required(),
});

module.exports = {
  signup2FASchema,
  verifyEmailSchema,
  login2FASchema,
  verify2FASchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
