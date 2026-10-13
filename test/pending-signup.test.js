'use strict';

/**
 * Self-check for the Page-picker selection: it holds a Facebook user token,
 * so only the user and business that started the login may spend it.
 * Run: node test/pending-signup.test.js
 */
const assert = require('assert');
const pendingSignup = require('../src/helpers/pendingSignup');

const id = pendingSignup.save({ userId: 6, businessId: 1, userAccessToken: 'EAAtoken' });

assert.strictEqual(pendingSignup.load(id, { userId: 6, businessId: 1 }).userAccessToken, 'EAAtoken');
// Reusable: one login can connect several Pages.
assert.ok(pendingSignup.load(id, { userId: 6, businessId: '1' }), 'business_id may arrive as a string');
assert.strictEqual(pendingSignup.load(id, { userId: 7, businessId: 1 }), null, 'another user must not use it');
assert.strictEqual(pendingSignup.load(id, { userId: 6, businessId: 2 }), null, 'another business must not use it');
assert.strictEqual(pendingSignup.load('nope', { userId: 6, businessId: 1 }), null);
assert.strictEqual(pendingSignup.expiredError().statusCode, 410);

console.log('pending-signup: all checks passed');
