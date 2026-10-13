'use strict';

const crypto = require('crypto');

/**
 * Holds a Facebook user token between "login finished" and "user picked which
 * Page(s) to connect".
 *
 * Meta's authorization code is single-use, so it can't be re-sent once the
 * user has chosen; and the user token must never reach the browser. The
 * browser gets an opaque selection_id instead, bound to the user and business
 * that started the login so nobody else can spend it.
 */
// ponytail: in-memory, single process — a restart drops open pickers and a
// second app instance won't see them; move to Redis when the app scales out.
const TTL_MS = 10 * 60 * 1000;
const pending = new Map();

const sweep = () => {
  const now = Date.now();
  for (const [id, entry] of pending) if (entry.expiresAt < now) pending.delete(id);
};

/**
 * @param {{ userId: number, businessId: number, userAccessToken: string }} data
 * @returns {string} selection_id
 */
const save = (data) => {
  sweep();
  const id = crypto.randomBytes(16).toString('hex');
  pending.set(id, { ...data, expiresAt: Date.now() + TTL_MS });
  return id;
};

/**
 * The stored entry, or null when it expired or belongs to someone else.
 * Not deleted on read: the user may connect several Pages from one login.
 */
const load = (id, { userId, businessId }) => {
  sweep();
  const entry = pending.get(id);
  if (!entry) return null;
  if (entry.userId !== userId || String(entry.businessId) !== String(businessId)) return null;
  return entry;
};

/** Error for a selection_id that can no longer be used. */
const expiredError = () => {
  const err = new Error('This Page selection has expired — continue with Facebook again.');
  err.statusCode = 410;
  return err;
};

module.exports = { save, load, expiredError };
