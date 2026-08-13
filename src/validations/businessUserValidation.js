const Joi = require("joi");

const inviteUserSchema = Joi.object({
  business_id: Joi.number().integer().positive().required(),
  email: Joi.string().email().trim().required(),
  name: Joi.string().trim().min(2).max(100).optional().allow(null, ''),
});

const acceptInvitationSchema = Joi.object({
  uuid: Joi.string().uuid().required(),
  token: Joi.string().trim().required(),
  password: Joi.string().min(6).required(),
});

const resendInvitationSchema = Joi.object({
  email: Joi.string().email().trim().required(),
});

module.exports = {
  inviteUserSchema,
  acceptInvitationSchema,
  resendInvitationSchema,
};
