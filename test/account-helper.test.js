'use strict';

/**
 * Self-check for which connected account a request acts through — picking the
 * wrong one sends a customer's reply from another number or Page.
 * Run: node test/account-helper.test.js
 */
const assert = require('assert');
const { resolveAccount } = require('../src/helpers/accountHelper');

// Minimal stand-in for a *Detail model: filters rows by the where clause.
const fakeModel = (rows) => ({
  findAll: async ({ where, limit }) =>
    rows.filter((r) => Object.entries(where).every(([k, v]) => String(r[k]) === String(v))).slice(0, limit),
});

const rejectsWith = async (promise, statusCode) => {
  await assert.rejects(promise, (err) => err.statusCode === statusCode);
};

(async () => {
  const single = fakeModel([{ id: 1, business_id: 7, is_active: true }]);
  const several = fakeModel([
    { id: 1, business_id: 7, is_active: true },
    { id: 2, business_id: 7, is_active: true },
    { id: 3, business_id: 8, is_active: true },
    { id: 4, business_id: 7, is_active: false },
  ]);

  // One account: no account_id needed, as before multi-account support.
  assert.strictEqual((await resolveAccount(single, 7, null, 'X')).id, 1);

  // Several accounts: the requested one is used.
  assert.strictEqual((await resolveAccount(several, 7, 2, 'X')).id, 2);

  // Several accounts and no choice: refuse instead of guessing.
  await rejectsWith(resolveAccount(several, 7, null, 'X'), 400);

  // Another business's account is never reachable.
  await rejectsWith(resolveAccount(several, 7, 3, 'X'), 404);

  // Inactive accounts are not used for sending.
  await rejectsWith(resolveAccount(several, 7, 4, 'X'), 404);

  // Nothing connected.
  await rejectsWith(resolveAccount(single, 99, null, 'X'), 404);

  console.log('account-helper: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
