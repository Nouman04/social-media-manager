const { Role, Permission, User, RolePermission, UserPermission, UserRole, Business } = require('../../models');
const {
  roleCreateSchema,
  roleUpdateSchema,
  permissionCreateSchema,
  permissionUpdateSchema,
  rolePermissionSchema,
  userPermissionSchema,
  userRoleSchema,
} = require('../validations/rbacValidation');

module.exports = {
  // Role CRUD
  createRole: async (req, res) => {
    try {
      const { error } = roleCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const { name, business_id } = req.body;

      const existingRole = await Role.findOne({ where: { name, business_id: business_id || null } });
      if (existingRole) {
        return res.status(400).json({ success: false, message: "Role with this name already exists" });
      }

      const role = await Role.create({ name, business_id: business_id || null });
      return res.status(201).json({ success: true, message: "Role created successfully", role });
    } catch (err) {
      console.error("[rbacController.createRole] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  getRoles: async (req, res) => {
    try {
      const { business_id } = req.query;
      const whereClause = business_id ? { business_id } : {};

      const roles = await Role.findAll({
        where: whereClause,
        include: [
          {
            model: Permission,
            as: 'permissions',
            attributes: ['id', 'name'],
            through: { attributes: [] },
          },
        ],
      });

      return res.status(200).json({ success: true, roles });
    } catch (err) {
      console.error("[rbacController.getRoles] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  getRoleById: async (req, res) => {
    try {
      const { id } = req.params;
      const role = await Role.findByPk(id, {
        include: [
          {
            model: Permission,
            as: 'permissions',
            attributes: ['id', 'name'],
            through: { attributes: [] },
          },
        ],
      });

      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }

      return res.status(200).json({ success: true, role });
    } catch (err) {
      console.error("[rbacController.getRoleById] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  updateRole: async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = roleUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const role = await Role.findByPk(id);
      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }

      const { name, business_id } = req.body;
      await role.update({
        name: name !== undefined ? name : role.name,
        business_id: business_id !== undefined ? business_id : role.business_id,
      });

      return res.status(200).json({ success: true, message: "Role updated successfully", role });
    } catch (err) {
      console.error("[rbacController.updateRole] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  deleteRole: async (req, res) => {
    try {
      const { id } = req.params;
      const role = await Role.findByPk(id);
      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }

      await role.destroy();
      return res.status(200).json({ success: true, message: "Role deleted successfully" });
    } catch (err) {
      console.error("[rbacController.deleteRole] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  // Permission CRUD
  createPermission: async (req, res) => {
    try {
      const { error } = permissionCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const { name, business_id } = req.body;

      const existingPermission = await Permission.findOne({ where: { name, business_id: business_id || null } });
      if (existingPermission) {
        return res.status(400).json({ success: false, message: "Permission with this name already exists" });
      }

      const permission = await Permission.create({ name, business_id: business_id || null });
      return res.status(201).json({ success: true, message: "Permission created successfully", permission });
    } catch (err) {
      console.error("[rbacController.createPermission] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  getPermissions: async (req, res) => {
    try {
      const { business_id } = req.query;
      const whereClause = business_id ? { business_id } : {};

      const permissions = await Permission.findAll({ where: whereClause });
      return res.status(200).json({ success: true, permissions });
    } catch (err) {
      console.error("[rbacController.getPermissions] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  getPermissionById: async (req, res) => {
    try {
      const { id } = req.params;
      const permission = await Permission.findByPk(id);
      if (!permission) {
        return res.status(404).json({ success: false, message: "Permission not found" });
      }

      return res.status(200).json({ success: true, permission });
    } catch (err) {
      console.error("[rbacController.getPermissionById] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  updatePermission: async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = permissionUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const permission = await Permission.findByPk(id);
      if (!permission) {
        return res.status(404).json({ success: false, message: "Permission not found" });
      }

      const { name, business_id } = req.body;
      await permission.update({
        name: name !== undefined ? name : permission.name,
        business_id: business_id !== undefined ? business_id : permission.business_id,
      });

      return res.status(200).json({ success: true, message: "Permission updated successfully", permission });
    } catch (err) {
      console.error("[rbacController.updatePermission] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  deletePermission: async (req, res) => {
    try {
      const { id } = req.params;
      const permission = await Permission.findByPk(id);
      if (!permission) {
        return res.status(404).json({ success: false, message: "Permission not found" });
      }

      await permission.destroy();
      return res.status(200).json({ success: true, message: "Permission deleted successfully" });
    } catch (err) {
      console.error("[rbacController.deletePermission] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  // Role Permissions
  givePermissionsToRole: async (req, res) => {
    try {
      const { roleId } = req.params;
      const { error } = rolePermissionSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const role = await Role.findByPk(roleId);
      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }

      const { permission_ids } = req.body;
      for (const permissionId of permission_ids) {
        await RolePermission.findOrCreate({
          where: { role_id: roleId, permission_id: permissionId },
        });
      }

      return res.status(200).json({ success: true, message: "Permissions assigned to role successfully" });
    } catch (err) {
      console.error("[rbacController.givePermissionsToRole] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  revokePermissionsFromRole: async (req, res) => {
    try {
      const { roleId } = req.params;
      const { error } = rolePermissionSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const { permission_ids } = req.body;
      await RolePermission.destroy({
        where: {
          role_id: roleId,
          permission_id: permission_ids,
        },
      });

      return res.status(200).json({ success: true, message: "Permissions revoked from role successfully" });
    } catch (err) {
      console.error("[rbacController.revokePermissionsFromRole] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  // Model / User Direct Permissions
  givePermissionsToUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const { error } = userPermissionSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const { permission_ids } = req.body;
      for (const permissionId of permission_ids) {
        await UserPermission.findOrCreate({
          where: { user_id: userId, permission_id: permissionId },
        });
      }

      return res.status(200).json({ success: true, message: "Direct permissions assigned to user successfully" });
    } catch (err) {
      console.error("[rbacController.givePermissionsToUser] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  revokePermissionsFromUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const { error } = userPermissionSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const { permission_ids } = req.body;
      await UserPermission.destroy({
        where: {
          user_id: userId,
          permission_id: permission_ids,
        },
      });

      return res.status(200).json({ success: true, message: "Direct permissions revoked from user successfully" });
    } catch (err) {
      console.error("[rbacController.revokePermissionsFromUser] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  // Assign / Remove User Roles
  assignRolesToUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const { error } = userRoleSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const { role_ids } = req.body;
      for (const roleId of role_ids) {
        await UserRole.findOrCreate({
          where: { user_id: userId, role_id: roleId },
        });
      }

      return res.status(200).json({ success: true, message: "Roles assigned to user successfully" });
    } catch (err) {
      console.error("[rbacController.assignRolesToUser] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  removeRolesFromUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const { error } = userRoleSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ success: false, message: "Validation failed", details: error.details.map(d => d.message) });
      }

      const { role_ids } = req.body;
      await UserRole.destroy({
        where: {
          user_id: userId,
          role_id: role_ids,
        },
      });

      return res.status(200).json({ success: true, message: "Roles removed from user successfully" });
    } catch (err) {
      console.error("[rbacController.removeRolesFromUser] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },

  // Get User Roles & Permissions
  getUserRolesAndPermissions: async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findByPk(userId, {
        attributes: ['id', 'name', 'email', 'status', 'business_id'],
        include: [
          {
            model: Role,
            as: 'roles',
            attributes: ['id', 'name'],
            through: { attributes: [] },
            include: [
              {
                model: Permission,
                as: 'permissions',
                attributes: ['id', 'name'],
                through: { attributes: [] },
              },
            ],
          },
          {
            model: Permission,
            as: 'permissions',
            attributes: ['id', 'name'],
            through: { attributes: [] },
          },
        ],
      });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const directPermissions = (user.permissions || []).map(p => ({ id: p.id, name: p.name, source: 'direct' }));
      const rolePermissionsMap = new Map();

      (user.roles || []).forEach(role => {
        (role.permissions || []).forEach(p => {
          if (!rolePermissionsMap.has(p.id)) {
            rolePermissionsMap.set(p.id, { id: p.id, name: p.name, source: `role:${role.name}` });
          }
        });
      });

      const allPermissions = [...directPermissions];
      rolePermissionsMap.forEach((val) => {
        if (!allPermissions.some(p => p.id === val.id)) {
          allPermissions.push(val);
        }
      });

      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
          business_id: user.business_id,
          roles: (user.roles || []).map(r => ({ id: r.id, name: r.name })),
          direct_permissions: directPermissions,
          all_permissions: allPermissions,
        },
      });
    } catch (err) {
      console.error("[rbacController.getUserRolesAndPermissions] Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
  },
};
