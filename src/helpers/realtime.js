'use strict';

/**
 * Thin wrapper around Socket.IO.
 *
 * Services import this rather than the server itself, so emitting never
 * creates a circular dependency and stays a no-op when sockets are disabled
 * (tests, CLI scripts, migrations).
 *
 * Clients join one room per business — `business:<id>` — so a tenant only
 * ever receives its own traffic.
 */

let io = null;

/**
 * Attach Socket.IO to an existing HTTP server.
 * @param {import('http').Server} httpServer
 * @param {object} [options] - Extra Socket.IO server options.
 */
const init = (httpServer, options = {}) => {
  // Required lazily so environments without the dependency still boot.
  const { Server } = require('socket.io');

  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    ...options,
  });

  io.on('connection', (socket) => {
    console.log(`[realtime] client connected: ${socket.id}`);

    // The client tells us which business inbox it is watching.
    socket.on('join', (payload) => {
      const businessId = payload && (payload.business_id ?? payload);
      if (!businessId) return;
      const room = `business:${businessId}`;
      socket.join(room);
      socket.emit('joined', { room });
      console.log(`[realtime] ${socket.id} joined ${room}`);
    });

    socket.on('leave', (payload) => {
      const businessId = payload && (payload.business_id ?? payload);
      if (!businessId) return;
      socket.leave(`business:${businessId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[realtime] client disconnected: ${socket.id} (${reason})`);
    });
  });

  console.log('[realtime] Socket.IO ready');
  return io;
};

/**
 * Push an event to everyone watching one business.
 * Silently does nothing when sockets were never initialised.
 *
 * @param {number|string} businessId
 * @param {string} event   - e.g. 'message:inbound', 'message:status'
 * @param {object} payload
 */
const emitToBusiness = (businessId, event, payload) => {
  if (!io || !businessId) return;
  io.to(`business:${businessId}`).emit(event, payload);
};

const getIo = () => io;

module.exports = { init, emitToBusiness, getIo };
