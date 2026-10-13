'use strict';

const axios = require('axios');

/**
 * GET a Graph API list edge and follow paging.next until it runs out.
 *
 * Edges like /me/accounts return 25 rows by default and silently stop there,
 * so a business with more Pages than that would never see the rest.
 *
 * @param {string} url
 * @param {object} params - Query params for the first request (incl. access_token).
 * @returns {Promise<Array>}
 */
const getAllPages = async (url, params) => {
  const rows = [];
  let next = url;
  let query = { limit: 100, ...params };

  // ponytail: hard cap guards against a paging loop; 50 × 100 rows is far past any real account.
  for (let i = 0; next && i < 50; i++) {
    const { data } = await axios.get(next, { params: query });
    rows.push(...(data?.data || []));
    next = data?.paging?.next || null;
    query = undefined; // paging.next already carries every param, token included
  }

  return rows;
};

module.exports = { getAllPages };
