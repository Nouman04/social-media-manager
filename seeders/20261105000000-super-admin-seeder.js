'use strict';

const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');

const SUPER_ADMIN_EMAIL = 'super_admin@gmail.com';
const SUPER_ADMIN_PASSWORD = 'test@123';
const SUPER_ADMIN_ROLE = 'super_admin';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const now = new Date();

    // 1. Ensure the 'super_admin' role exists
    let [roles] = await queryInterface.sequelize.query(
      'SELECT id, name FROM roles WHERE name = :roleName AND business_id IS NULL LIMIT 1',
      { replacements: { roleName: SUPER_ADMIN_ROLE } }
    );

    let roleId;
    if (roles && roles.length > 0) {
      roleId = roles[0].id;
    } else {
      await queryInterface.bulkInsert('roles', [
        {
          name: SUPER_ADMIN_ROLE,
          business_id: null,
          created_at: now,
          updated_at: now,
        },
      ]);

      const [newRoles] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :roleName AND business_id IS NULL LIMIT 1',
        { replacements: { roleName: SUPER_ADMIN_ROLE } }
      );
      roleId = newRoles[0].id;
    }

    // 2. Check if user already exists
    const [existingUsers] = await queryInterface.sequelize.query(
      'SELECT id, email FROM users WHERE email = :email LIMIT 1',
      { replacements: { email: SUPER_ADMIN_EMAIL } }
    );

    let userId;
    const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);

    if (existingUsers && existingUsers.length > 0) {
      userId = existingUsers[0].id;
      await queryInterface.bulkUpdate(
        'users',
        {
          password: hashedPassword,
          status: 'active',
          email_verified_at: now,
          updated_at: now,
        },
        { id: userId }
      );
    } else {
      await queryInterface.bulkInsert('users', [
        {
          uuid: randomUUID(),
          name: 'Super Admin',
          email: SUPER_ADMIN_EMAIL,
          password: hashedPassword,
          status: 'active',
          email_verified_at: now,
          authentication_code: null,
          code_expired_at: null,
          authentication_token: null,
          invitation_expired_at: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ]);

      const [createdUsers] = await queryInterface.sequelize.query(
        'SELECT id FROM users WHERE email = :email LIMIT 1',
        { replacements: { email: SUPER_ADMIN_EMAIL } }
      );
      userId = createdUsers[0].id;
    }

    // 3. Assign role to user in model_has_roles
    const [existingRoleAssignments] = await queryInterface.sequelize.query(
      'SELECT id FROM model_has_roles WHERE user_id = :userId AND role_id = :roleId LIMIT 1',
      { replacements: { userId, roleId } }
    );

    if (!existingRoleAssignments || existingRoleAssignments.length === 0) {
      await queryInterface.bulkInsert('model_has_roles', [
        {
          user_id: userId,
          role_id: roleId,
          created_at: now,
          updated_at: now,
        },
      ]);
    }
  },

  down: async (queryInterface, Sequelize) => {
    const [users] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE email = :email LIMIT 1',
      { replacements: { email: SUPER_ADMIN_EMAIL } }
    );

    if (users && users.length > 0) {
      const userId = users[0].id;
      await queryInterface.bulkDelete('model_has_roles', { user_id: userId });
      await queryInterface.bulkDelete('users', { id: userId });
    }
  },
};

