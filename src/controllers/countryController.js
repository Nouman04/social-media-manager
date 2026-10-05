'use strict';

const { Country } = require('../../models');

module.exports = {
  /** GET /countries */
  getCountries: async (req, res) => {
    try {
      const countries = await Country.findAll({ attributes: ['id', 'name', 'code'], order: [['name', 'ASC']] });
      return res.status(200).json({ success: true, countries });
    } catch (err) {
      console.error('[countryController.getCountries] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },
};
