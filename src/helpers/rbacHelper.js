'use strict';

const { User, Role, Permission } = require('../../models');

/**
 * A user's roles plus the effective permission list (direct grants first, then
 * anything inherited through a role, de-duplicated by id).
 * Returns { roles, direct_permissions, all_permissions } or null if no such user.
 */
const getRolesAndPermissions = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: ['id'],
    include: [
      {
        model: Role,
        as: 'roles',
        attributes: ['id', 'name'],
        through: { attributes: [] },
        include: [{ model: Permission, as: 'permissions', attributes: ['id', 'name'], through: { attributes: [] } }],
      },
      { model: Permission, as: 'permissions', attributes: ['id', 'name'], through: { attributes: [] } },
    ],
  });
  if (!user) return null;

  const direct_permissions = user.permissions.map(p => ({ id: p.id, name: p.name, source: 'direct' }));
  const all = new Map(direct_permissions.map(p => [p.id, p]));
  user.roles.forEach(role =>
    role.permissions.forEach(p => {
      if (!all.has(p.id)) all.set(p.id, { id: p.id, name: p.name, source: `role:${role.name}` });
    })
  );

  return {
    roles: user.roles.map(r => ({ id: r.id, name: r.name })),
    direct_permissions,
    all_permissions: [...all.values()],
  };
};

module.exports = { getRolesAndPermissions };
