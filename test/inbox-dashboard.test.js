'use strict';

/**
 * Self-check for the inbox keyset pagination, message text extraction and
 * dashboard date ranges. Pure functions only, no DB.
 * Run: node test/inbox-dashboard.test.js
 */
const assert = require('assert');
const { _internals: inbox } = require('../src/services/inboxService');
const { _internals: dash } = require('../src/services/dashboardService');

// ── Cursor round-trip and rejection ─────────────────────────────────────────
const cur = inbox.encodeCursor(['2026-11-13T09:12:00.000Z', 812]);
assert.deepStrictEqual(inbox.decodeCursor(cur), ['2026-11-13T09:12:00.000Z', 812]);
assert.throws(() => inbox.decodeCursor('not-a-cursor'), /Invalid cursor/);

// ── Keyset: ties on last_message_at fall through to id, so no row repeats ───
const r = {};
const sql = inbox.keysetCondition(inbox.SORTS.last_message_desc, ['2026-11-13T09:12:00.000Z', 812], r);
assert.strictEqual(sql, '(c.last_message_at < :cur0 OR (c.last_message_at = :cur0 AND c.id < :cur1))');
assert.strictEqual(r.cur0, '2026-11-13 09:12:00', 'UTC string, never a local-zone Date');
assert.strictEqual(r.cur1, 812);
const asc = inbox.keysetCondition(inbox.SORTS.last_message_asc, ['2026-11-13T09:12:00.000Z', 1], {});
assert.ok(asc.includes('c.last_message_at >') && asc.includes('c.id >'));
assert.strictEqual(inbox.SORTS.unread_first.length, 3);

// ── Message text / media across channel payload shapes ──────────────────────
assert.strictEqual(inbox.messageText({ message_type: 'text', payload: { text: { body: 'hi' } } }), 'hi', 'WhatsApp');
assert.strictEqual(inbox.messageText({ message_type: 'image', payload: { image: { caption: 'cap' } } }), 'cap', 'WA caption');
assert.strictEqual(inbox.messageText({ message_type: 'text', payload: { message: { text: 'ig' } } }), 'ig', 'IG/Messenger');
assert.strictEqual(inbox.messageText({ message_type: 'template', payload: { template: { name: 'promo' } } }), 'promo');
assert.strictEqual(inbox.messageText({ message_type: 'image', payload: null }), null);
assert.strictEqual(inbox.mediaUrl({ message_type: 'image', payload: { image: { local_url: '/public/uploads/a.jpg', link: 'x' } } }), '/public/uploads/a.jpg');
assert.strictEqual(inbox.mediaUrl({ message_type: 'image', payload: { message: { attachments: [{ payload: { url: 'u' } }] } } }), 'u');
assert.strictEqual(inbox.mediaUrl({ message_type: 'image', payload: { message: { attachment: { payload: { url: 'o' } } } } }), 'o');

// ── Dashboard ranges: `to` is inclusive, previous period is the same length ─
const range = dash.parseRange({ from: '2026-11-01', to: '2026-11-14' });
assert.strictEqual(range.start.toISOString(), '2026-11-01T00:00:00.000Z');
assert.strictEqual(range.end.toISOString(), '2026-11-15T00:00:00.000Z');
assert.strictEqual(range.prevEnd.getTime(), range.start.getTime());
assert.strictEqual(range.start - range.prevStart, range.end - range.start);
assert.throws(() => dash.parseRange({ from: '2026-11-14', to: '2026-11-01' }), /before/);
assert.throws(() => dash.parseRange({ from: 'nope' }), /dates/);
assert.throws(() => dash.parseRange({ from: '2024-01-01', to: '2026-01-01' }), /366/);

assert.strictEqual(dash.median([]), null);
assert.strictEqual(dash.median([5, 1, 3]), 3);
assert.strictEqual(dash.median([1, 2, 3, 4]), 3);
assert.strictEqual(dash.mondayOf('2026-11-14'), '2026-11-09', 'Saturday → Monday');
assert.strictEqual(dash.mondayOf('2026-11-09'), '2026-11-09');

console.log('inbox-dashboard: all checks passed');
process.exit(0);
