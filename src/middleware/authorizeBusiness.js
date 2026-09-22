'use strict';

const { Business, BusinessUser } = require('../../models');

/**
 * Tenant guard.
 *
 * `authenticate` only proves the caller is *a* real user — it says nothing
 * about which business they may act for. Every Instagram endpoint takes
 * business_id straight from the request, so without this any signed-in vendor
 * could pass someone else's business_id and read their inbox or send DMs as
 * them. This confirms the caller actually owns or belongs to that business.
 *
 * Reads business_id from the body (POST/PUT) or the query string (GET/DELETE)
 * and hands the resolved value to handlers as req.businessId.
 */
const authorizeBusiness = async (req, res, next) => {
  const businessId = req.body?.business_id ?? req.query?.business_id;

  if (!businessId) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      details: ['business_id is required'],
    });
  }

  try {
    const business = await Business.findByPk(businessId, { attributes: ['id', 'created_by'] });
    if (!business) {
      return res.status(404).json({ success: false, message: `Business ${businessId} not found` });
    }

    // Owner, or a member linked through business_users.
    let allowed = business.created_by === req.user.id;
    if (!allowed) {
      const link = await BusinessUser.findOne({
        where: { business_id: business.id, user_id: req.user.id },
        attributes: ['id'],
      });
      allowed = Boolean(link);
    }

    if (!allowed) {
      console.warn(
        `[authorizeBusiness] DENIED | user=${req.user.id} tried to act for business=${businessId}`
      );
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you do not have access to this business',
      });
    }

    req.businessId = business.id;
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = authorizeBusiness;
