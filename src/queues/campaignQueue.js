'use strict';

const { Queue, Worker } = require('bullmq');

/**
 * BullMQ queue for campaign sends — one job per recipient.
 *
 * Jobs live in Redis, so a server restart pauses a campaign instead of losing
 * it: the worker picks up where it stopped. Retries with backoff cover Meta
 * hiccups; the limiter keeps the send rate gentle on the number's quality.
 *
 * This module only wires BullMQ. What a job does lives in campaignService,
 * which hands its processor to startWorker().
 */
const QUEUE_NAME = 'campaign-sends';

// redis://[user:password@]host:port[/db] — rediss:// switches TLS on.
const connectionFromUrl = (url) => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number(u.pathname.slice(1)) || 0,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
};

const connection = connectionFromUrl(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

let queue = null;
const getQueue = () => {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      // Fail fast when Redis is down rather than hanging the HTTP request.
      connection: { ...connection, enableOfflineQueue: false },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    queue.on('error', (err) => console.error('[campaignQueue] queue error:', err.message));
  }
  return queue;
};

const withTimeout = (promise, ms, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
]);

/**
 * Add one job per recipient. jobId = recipient id, so re-enqueueing the same
 * recipient (a resumed campaign) never sends twice.
 *
 * @throws {Error} statusCode 503 when Redis can't be reached.
 */
const enqueueRecipients = async (campaignId, recipientIds) => {
  try {
    const q = getQueue();
    await withTimeout(q.waitUntilReady(), 3000, 'Redis did not answer within 3s');
    await q.addBulk(recipientIds.map((recipientId) => ({
      name: 'send',
      data: { campaignId, recipientId },
      opts: { jobId: `recipient-${recipientId}` },
    })));
  } catch (err) {
    const wrapped = new Error(`Campaign queue unavailable — is Redis running? (${err.message})`);
    wrapped.statusCode = 503;
    throw wrapped;
  }
};

/**
 * Start the worker in this process.
 * ponytail: one global limiter for every number; give each WhatsApp number its
 * own limiter (group key) once several numbers send campaigns at once.
 *
 * @param {(job) => Promise<any>} processor
 */
const startWorker = (processor) => {
  const worker = new Worker(QUEUE_NAME, processor, {
    connection,
    concurrency: 3,
    limiter: { max: 6, duration: 1000 }, // ~6 messages per second
  });

  // ioredis retries forever while Redis is down — log the outage once, not per retry.
  let down = false;
  worker.on('error', (err) => {
    if (!down) console.error('[campaignQueue] worker cannot reach Redis:', err.message);
    down = true;
  });
  worker.on('ready', () => {
    if (down) console.log('[campaignQueue] worker reconnected to Redis');
    down = false;
  });
  worker.on('failed', (job, err) => {
    console.warn(`[campaignQueue] job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`);
  });

  console.log('[campaignQueue] worker started');
  return worker;
};

module.exports = { enqueueRecipients, startWorker, QUEUE_NAME };
