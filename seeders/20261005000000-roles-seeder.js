'use strict';

const NAMES = ['super_admin', 'organization_admin'];

module.exports = {
  up: async (queryInterface) => {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT name FROM roles WHERE business_id IS NULL AND name IN (:names)',
      { replacements: { names: NAMES } }
    );
    const have = new Set(existing.map((r) => r.name));
    const rows = NAMES.filter((n) => !have.has(n)).map((name) => ({
      name,
      business_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    }));
    if (rows.length) await queryInterface.bulkInsert('roles', rows);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('roles', { name: NAMES, business_id: null });
  },
};
