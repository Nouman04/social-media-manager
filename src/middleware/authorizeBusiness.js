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
    return admit(req, res, next, business, businessId);
  } catch (err) {
    return next(err);
  }
};

/** Owner, or a member linked through business_users → req.businessId; else 404 / 403. */
const admit = async (req, res, next, business, label) => {
  if (!business) {
    return res.status(404).json({ success: false, message: `Business ${label} not found` });
  }

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
      `[authorizeBusiness] DENIED | user=${req.user.id} tried to act for business=${label}`
    );
    return res.status(403).json({
      success: false,
      message: 'Forbidden: you do not have access to this business',
    });
  }

  req.businessId = business.id;
  return next();
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Same guard, but the business is named by its public uuid: `business_uuid`
 * in the body (POST/PUT/PATCH) or query (GET/DELETE). business_id is refused,
 * so a route on this guard has one way in. Used by the Unified Inbox.
 */
authorizeBusiness.byUuid = async (req, res, next) => {
  if ((req.body?.business_id ?? req.query?.business_id) !== undefined) {
    return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is not accepted; send business_uuid'] });
  }
  const uuid = req.body?.business_uuid ?? req.query?.business_uuid;
  if (!uuid) {
    return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_uuid is required'] });
  }
  if (!UUID_RE.test(String(uuid))) {
    // e.g. an unresolved Postman variable "{{businessUuid}}"
    return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_uuid must be a valid UUID (is the {{businessUuid}} variable set?)'] });
  }

  try {
    // uuids are stored lowercase and the column compares case-sensitively.
    const business = await Business.findOne({ where: { uuid: String(uuid).toLowerCase() }, attributes: ['id', 'created_by'] });
    return admit(req, res, next, business, uuid);
  } catch (err) {
    return next(err);
  }
};

module.exports = authorizeBusiness;
