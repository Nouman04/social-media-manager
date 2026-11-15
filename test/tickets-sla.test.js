'use strict';

/**
 * Self-check for ticket SLA status: on_track / at_risk / breached / met.
 * Run: node test/tickets-sla.test.js
 */
const assert = require('assert');
const { computeSlaStatus } = require('../src/services/ticketService');

const MIN = 60 * 1000;
const t0 = new Date('2026-11-15T10:00:00Z');
const at = (min) => new Date(t0.getTime() + min * MIN);
// Policy: first response in 60 min, resolution in 240 min.
const base = { created_at: t0, first_response_due_at: at(60), resolution_due_at: at(240), status: 'open' };

assert.strictEqual(computeSlaStatus({ ...base, first_response_due_at: null, resolution_due_at: null }, at(5)), null, 'no policy → null');
assert.strictEqual(computeSlaStatus(base, at(10)), 'on_track', 'early');
assert.strictEqual(computeSlaStatus(base, at(50)), 'at_risk', 'less than 25% of the first-response window left');
assert.strictEqual(computeSlaStatus(base, at(61)), 'breached', 'no first response by its due time');
assert.strictEqual(computeSlaStatus({ ...base, first_responded_at: at(30) }, at(61)), 'on_track', 'responded in time; resolution window still roomy');
assert.strictEqual(computeSlaStatus({ ...base, first_responded_at: at(30) }, at(200)), 'at_risk', 'resolution window nearly used');
assert.strictEqual(computeSlaStatus({ ...base, first_responded_at: at(30) }, at(241)), 'breached', 'resolution overdue');
assert.strictEqual(computeSlaStatus({ ...base, first_responded_at: at(90) }, at(100)), 'breached', 'first response came late');
assert.strictEqual(computeSlaStatus({ ...base, status: 'resolved', first_responded_at: at(30), resolved_at: at(200) }, at(500)), 'met', 'resolved in time stays met');
assert.strictEqual(computeSlaStatus({ ...base, status: 'resolved', first_responded_at: at(30), resolved_at: at(300) }, at(500)), 'breached', 'resolved late');
assert.strictEqual(computeSlaStatus({ ...base, status: 'closed', first_responded_at: at(30), closed_at: at(100) }, at(500)), 'met', 'closed in time');

console.log('tickets-sla: all checks passed');
process.exit(0);
