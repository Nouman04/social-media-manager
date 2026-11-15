'use strict';

const dashboard = require('../services/dashboardService');

const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, data: await fn({ businessId: req.businessId, userId: req.user.id, query: req.query }) });
  } catch (err) {
    const status = err.status || err.statusCode;
    if (status && status < 500) return res.status(status).json({ success: false, message: err.message });
    console.error(`[dashboardController] ${req.originalUrl} Error:`, err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  summary: handle(dashboard.summary),
  messageVolume: handle(dashboard.messageVolume),
  teamPerformance: handle(dashboard.teamPerformance),
  numberHealth: handle(dashboard.numberHealth),
};
