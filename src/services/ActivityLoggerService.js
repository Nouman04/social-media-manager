'use strict';

const { ActivityLog } = require('../../models');
const asyncContext = require('../helpers/asyncContext');

class ActivityLoggerService {
  /**
   * Log an activity
   * @param {Object} options 
   * @param {Object} [options.req] Express request object to extract IP and user agent
   * @param {String} options.logName Category/Table name (e.g., 'users', 'subscriptions')
   * @param {String} options.description Human-readable description
   * @param {String} options.subjectType Model name of the subject
   * @param {String|Number} options.subjectId ID of the subject
   * @param {String} [options.causerType='User'] Type of the causer (User or System)
   * @param {String|Number} [options.causerId] ID of the logged-in user making the change
   * @param {Object} options.properties JSON object containing `old` and `attributes`
   */
  static async log(options) {
    try {
      let { req } = options;
      if (!req) {
        const store = asyncContext.getStore();
        if (store && store.has('req')) {
          req = store.get('req');
        }
      }

      const {
        logName = 'default',
        description,
        subjectType,
        subjectId,
        causerType = 'User',
        causerId,
        properties
      } = options;

      let ip_address = null;
      let user_agent = null;
      let causer_id = causerId;

      if (req) {
        ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;
        user_agent = req.headers['user-agent'];
        if (!causer_id && req.user && req.user.id) {
          causer_id = req.user.id;
        }
      }

      await ActivityLog.create({
        log_name: logName,
        description,
        subject_type: subjectType,
        subject_id: subjectId ? String(subjectId) : null,
        causer_type: causerType,
        causer_id: causer_id ? String(causer_id) : null,
        properties,
        ip_address,
        user_agent
      });
    } catch (err) {
      console.error('[ActivityLoggerService] Failed to create activity log:', err);
      // We swallow the error so that the main execution flow is not interrupted.
    }
  }
}

module.exports = ActivityLoggerService;
