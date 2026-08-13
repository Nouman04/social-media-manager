'use strict';

const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');

/**
 * Seeds 5 verified users.
 *
 * "Verified" here matches what verifyEmail() in twoFactorAuthController sets on
 * a real signup: status = 'active', email_verified_at populated, and the
 * one-time code fields cleared.
 *
 * Passwords are hashed with the same cost factor the app uses (10), so these
 * accounts can log in through /auth/login with the password below.
 */

const SEED_PASSWORD = 'Password123!';

const USERS = [
  { name: 'Alice Johnson', email: 'alice@example.com' },
  { name: 'Bilal Ahmed', email: 'bilal@example.com' },
  { name: 'Carlos Mendes', email: 'carlos@example.com' },
  { name: 'Dina Farouk', email: 'dina@example.com' },
  { name: 'Emma Wilson', email: 'emma@example.com' },
];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const now = new Date();
    const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

    // The users table has no unique index on email, so re-running this seeder
    // would otherwise insert duplicates. Only add the ones missing.
    const [existing] = await queryInterface.sequelize.query(
      'SELECT email FROM users WHERE email IN (:emails)',
      { replacements: { emails: USERS.map(u => u.email) } }
    );
    const taken = new Set(existing.map(row => row.email));

    const rows = USERS
      .filter(u => !taken.has(u.email))
      .map(u => ({
        // bulkInsert bypasses model defaults, so the uuid must be supplied here.
        uuid: randomUUID(),
        name: u.name,
        email: u.email,
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
      }));

    if (!rows.length) return;

    await queryInterface.bulkInsert('users', rows);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('users', {
      email: { [Sequelize.Op.in]: USERS.map(u => u.email) },
    });
  },
};
