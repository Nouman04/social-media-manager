'use strict';

/**
 * Self-check for the parsing that decides who gets messaged and what they
 * read: phone normalisation, the opt-in column, and template variables.
 * Run: node test/contacts-campaigns.test.js
 */
const assert = require('assert');
const { normalizePhone, parseConsent } = require('../src/services/contactService');
const { renderVariable } = require('../src/services/campaignService');

// ── Phones: a wrong number is a message to a stranger ───────────────────────
assert.strictEqual(normalizePhone('+92 300-1234567', '92'), '923001234567');
assert.strictEqual(normalizePhone('03001234567', '92'), '923001234567');
assert.strictEqual(normalizePhone('3001234567', '92'), '923001234567', 'Excel drops the leading 0');
assert.strictEqual(normalizePhone('00923001234567', '92'), '923001234567');
assert.strictEqual(normalizePhone('923001234567', '92'), '923001234567', 'already international');
assert.strictEqual(normalizePhone('+6591234567', '92'), '6591234567', 'a + number keeps its own country');
assert.strictEqual(normalizePhone('03001234567', ''), null, 'local number with no default code is ambiguous');
assert.strictEqual(normalizePhone('abc', '92'), null);
assert.strictEqual(normalizePhone('', '92'), null);

// ── Consent: anything unclear must not count as opted in ────────────────────
assert.strictEqual(parseConsent('Yes'), 'opted_in');
assert.strictEqual(parseConsent('STOP'), 'opted_out');
assert.strictEqual(parseConsent(''), null);
assert.strictEqual(parseConsent('maybe'), null);

// ── Template variables ──────────────────────────────────────────────────────
const ali = { name: 'Ali', phone: '923001234567', email: null };
assert.strictEqual(renderVariable('{{contact.name}}', ali), 'Ali');
assert.strictEqual(renderVariable('Hi {{ contact.name }}!', ali), 'Hi Ali!');
assert.strictEqual(renderVariable('{{contact.email|friend}}', ali), 'friend', 'fallback for an empty field');
assert.strictEqual(renderVariable('20% off', ali), '20% off', 'fixed text untouched');

console.log('contacts-campaigns: all checks passed');
