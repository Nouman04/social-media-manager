'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Throws 400 unless `value` is a UUID; returns it lowercased (uuids are stored lowercase, compared case-sensitively). */
const requireUuid = (value, field = 'uuid') => {
  if (!UUID_RE.test(String(value || ''))) throw httpError(400, `${field} must be a valid UUID`);
  return String(value).toLowerCase();
};

module.exports = { UUID_RE, requireUuid, httpError };
