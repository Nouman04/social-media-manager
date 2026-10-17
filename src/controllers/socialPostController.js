'use strict';

const socialPostService = require('../services/socialPostService');

/**
 * Shared error responder — forwards the service's statusCode and any
 * Graph API error detail attached to it.
 */
const fail = (res, err, context) => {
  console.error(`[socialPostController.${context}] Error:`, err.message);
  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    ...(err.metaError && { metaError: err.metaError }),
  });
};

// Every handler runs behind authorizeBusiness (req.businessId is trusted).
module.exports = {

  /**
   * GET /api/v1/posts?business_id=&platform=instagram|facebook&account_id=&filter=all|commented|uncommented&after=&limit=
   */
  listPosts: async (req, res) => {
    try {
      const { platform, account_id, filter, after, limit } = req.query;
      const data = await socialPostService.listPosts(req.businessId, {
        platform, accountId: account_id || null, filter: filter || 'all', after, limit,
      });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'listPosts');
    }
  },

  /**
   * GET /api/v1/posts/:postId/comments?business_id=&platform=&account_id=&after=
   */
  listComments: async (req, res) => {
    try {
      const { platform, account_id, after } = req.query;
      const data = await socialPostService.listComments(req.businessId, req.params.postId, {
        platform, accountId: account_id || null, after,
      });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'listComments');
    }
  },

  /**
   * POST /api/v1/posts/comments
   * Body: { business_id, platform, account_id?, object_id, target: 'post' | 'comment', message }
   * target post = comment on the post; target comment = reply to that comment.
   */
  comment: async (req, res) => {
    try {
      const { platform, account_id, object_id, target, message } = req.body;
      const comment = await socialPostService.comment(req.businessId, {
        platform, accountId: account_id || null, objectId: object_id, target, message,
      });
      return res.status(201).json({ success: true, comment });
    } catch (err) {
      return fail(res, err, 'comment');
    }
  },

  /**
   * POST /api/v1/posts/reactions
   * Body: { business_id, platform: 'facebook', account_id?, object_id, action: 'like' | 'unlike' }
   * object_id is a post or comment id. Instagram answers 400 (no like API).
   */
  react: async (req, res) => {
    try {
      const { platform, account_id, object_id, action } = req.body;
      const data = await socialPostService.react(req.businessId, {
        platform, accountId: account_id || null, objectId: object_id, action,
      });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'react');
    }
  },
};
