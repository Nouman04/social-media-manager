const Joi = require("joi");

const roleCreateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  business_id: Joi.number().integer().positive().allow(null).optional(),
});

const roleUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  business_id: Joi.number().integer().positive().allow(null).optional(),
});

const permissionCreateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  business_id: Joi.number().integer().positive().allow(null).optional(),
});

const permissionUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  business_id: Joi.number().integer().positive().allow(null).optional(),
});

const rolePermissionSchema = Joi.object({
  permission_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
});

const userPermissionSchema = Joi.object({
  permission_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
});

const userRoleSchema = Joi.object({
  role_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
});

module.exports = {
  roleCreateSchema,
  roleUpdateSchema,
  permissionCreateSchema,
  permissionUpdateSchema,
  rolePermissionSchema,
  userPermissionSchema,
  userRoleSchema,
};
