'use strict';

/**
 * Self-check for the two id decisions that silently break Instagram for a
 * tenant: which Graph host a token belongs to, and which participant in a
 * thread is the contact. Run: node test/instagram-ids.test.js
 */
const assert = require('assert');
const { _graphBase: graphBase, _pickContactId: pickContactId } = require('../src/services/instagramService');

// ── Host routing: the wrong host makes every send fail with "(#3) ..." ──────
assert.ok(
  graphBase('IGAAabc123').startsWith('https://graph.instagram.com/'),
  'IGAA tokens must route to graph.instagram.com'
);
assert.ok(
  graphBase('EAAGm0PX4ZCpsBA').startsWith('https://graph.facebook.com/'),
  'Page tokens must route to graph.facebook.com'
);
assert.ok(
  graphBase(null).startsWith('https://graph.facebook.com/'),
  'A missing token must not crash host selection'
);

// ── Contact picking: picking our own id would DM the account itself ────────
const detail = { ig_user_id: '17841437913367528', ig_scoped_id: '1767391427788536' };

assert.strictEqual(
  pickContactId([{ id: '1767391427788536' }, { id: '28282620628047512' }], detail),
  '28282620628047512',
  'must skip our scoped id and return the contact'
);
assert.strictEqual(
  pickContactId([{ id: '17841437913367528' }, { id: '28282620628047512' }], detail),
  '28282620628047512',
  'must skip our classic id too — Meta may report either'
);
assert.strictEqual(
  pickContactId([{ id: '1767391427788536' }], detail),
  null,
  'a thread with only us must resolve to null, not to our own id'
);
assert.strictEqual(pickContactId(undefined, detail), null, 'no participants must not throw');

// An account that has never had its scoped id resolved must still work.
assert.strictEqual(
  pickContactId([{ id: '17841437913367528' }, { id: '999' }], { ig_user_id: '17841437913367528', ig_scoped_id: null }),
  '999',
  'a null ig_scoped_id must not match a real participant'
);

console.log('instagram-ids: all checks passed');
