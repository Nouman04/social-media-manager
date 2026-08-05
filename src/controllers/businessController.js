'use strict';

const { Op } = require('sequelize');
const { Business, BusinessSocial, SocialNumber, BusinessSocialNumber, Address, sequelize } = require('../../models');
const {
  businessCreateSchema,
  businessUpdateSchema,
  socialNumberCreateSchema,
  socialNumberUpdateSchema,
  businessSocialCreateSchema,
  businessSocialUpdateSchema,
  syncSocialNumberSchema,
  unsyncSocialNumberSchema,
} = require('../validations/businessValidation');
const { createAddress, upsertAddress, deleteAddress } = require('../helpers/addressHelper');

const ADDRESSABLE_TYPE = 'Business';

const addressInclude = { model: Address, as: 'address', attributes: ['id', 'address'], required: false };

// Social numbers synced to a business social, via the business_social_numbers pivot.
const socialNumbersInclude = {
  model: SocialNumber,
  as: 'socialNumbers',
  attributes: ['id', 'phone_number', 'is_activated'],
  through: { attributes: [] },
  required: false,
};

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  BUSINESSES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /business
   * Create a business. `address` is optional and stored in the polymorphic
   * addresses table via the address helper.
   */
  createBusiness: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { error, value } = businessCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const { name, is_active, address } = value;
      const created_by = req.user?.id ?? value.created_by;

      if (!created_by) {
        await t.rollback();
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const business = await Business.create(
        { created_by, name, is_active: is_active ?? true },
        { transaction: t }
      );

      await createAddress(ADDRESSABLE_TYPE, business.id, address, { transaction: t });

      await t.commit();

      const created = await Business.findByPk(business.id, { include: [addressInclude] });

      return res.status(201).json({
        success: true,
        message: 'Business created successfully',
        business: created,
      });
    } catch (err) {
      await t.rollback();
      console.error('[businessController.createBusiness] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * GET /business
   * List businesses. Filters: ?search= ?is_active= ?created_by=
   * Pagination: ?page= ?limit=
   */
  getBusinesses: async (req, res) => {
    try {
      const { search, is_active, created_by } = req.query;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

      const where = {};
      if (search) where.name = { [Op.like]: `%${search}%` };
      if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === '1';
      if (created_by) where.created_by = created_by;

      const { count, rows } = await Business.findAndCountAll({
        where,
        include: [addressInclude],
        // Without the id tiebreaker, rows sharing a created_at second can shift
        // between pages and be duplicated or skipped.
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset: (page - 1) * limit,
        distinct: true,
      });

      return res.status(200).json({
        success: true,
        businesses: rows,
        pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      console.error('[businessController.getBusinesses] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * GET /business/:id
   * Get a single business with its address.
   */
  getBusinessById: async (req, res) => {
    try {
      const { id } = req.params;

      const business = await Business.findByPk(id, { include: [addressInclude] });
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      return res.status(200).json({ success: true, business });
    } catch (err) {
      console.error('[businessController.getBusinessById] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * PUT /business/:id
   * Update a business. Sending `address` as null/'' removes the stored address;
   * omitting it leaves the existing address untouched.
   */
  updateBusiness: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;

      const { error, value } = businessUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const business = await Business.findByPk(id, { transaction: t });
      if (!business) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      const { name, is_active, address } = value;

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (is_active !== undefined) updates.is_active = is_active;
      if (Object.keys(updates).length) {
        await business.update(updates, { transaction: t });
      }

      await upsertAddress(ADDRESSABLE_TYPE, business.id, address, { transaction: t });

      await t.commit();

      const updated = await Business.findByPk(business.id, { include: [addressInclude] });

      return res.status(200).json({
        success: true,
        message: 'Business updated successfully',
        business: updated,
      });
    } catch (err) {
      await t.rollback();
      console.error('[businessController.updateBusiness] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * DELETE /business/:id
   * Delete a business along with its address row.
   */
  deleteBusiness: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;

      const business = await Business.findByPk(id, { transaction: t });
      if (!business) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      await deleteAddress(ADDRESSABLE_TYPE, business.id, { transaction: t });
      await business.destroy({ transaction: t });

      await t.commit();

      return res.status(200).json({ success: true, message: 'Business deleted successfully' });
    } catch (err) {
      await t.rollback();
      console.error('[businessController.deleteBusiness] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SOCIAL NUMBERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /business/social-numbers
   * Create a new social number linked to a business.
   */
  createSocialNumber: async (req, res) => {
    try {
      const { error, value } = socialNumberCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const { business_id, phone_number, is_activated } = value;

      const business = await Business.findByPk(business_id);
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      // phone_number is UNIQUE and the model is paranoid, so a soft-deleted row
      // still holds the index entry. Look past the soft-delete and revive it
      // instead of failing on a duplicate-key error.
      const existing = await SocialNumber.findOne({ where: { phone_number }, paranoid: false });
      if (existing && !existing.deleted_at) {
        return res.status(409).json({ success: false, message: 'Phone number already in use' });
      }
      if (existing) {
        await existing.restore();
        await existing.update({ business_id, is_activated: is_activated ?? false });
        return res.status(201).json({
          success: true,
          message: 'Social number created successfully',
          socialNumber: existing,
        });
      }

      const socialNumber = await SocialNumber.create({
        business_id,
        phone_number,
        is_activated: is_activated ?? false,
      });

      return res.status(201).json({
        success: true,
        message: 'Social number created successfully',
        socialNumber,
      });
    } catch (err) {
      console.error('[businessController.createSocialNumber] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * GET /business/:businessId/social-numbers
   * List the social numbers belonging to one business.
   * Unlike GET /business/social-numbers?business_id=, this 404s when the
   * business itself does not exist instead of returning an empty list.
   * Filters: ?phone_number= (partial) ?is_activated=
   */
  getSocialNumbersByBusiness: async (req, res) => {
    try {
      const { businessId } = req.params;
      const { phone_number, is_activated } = req.query;

      const business = await Business.findByPk(businessId, { attributes: ['id', 'name'] });
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      const where = { business_id: business.id };
      if (phone_number) where.phone_number = { [Op.like]: `%${phone_number}%` };
      if (is_activated !== undefined) where.is_activated = is_activated === 'true' || is_activated === '1';

      const socialNumbers = await SocialNumber.findAll({
        where,
        attributes: ['id', 'business_id', 'phone_number', 'is_activated', 'created_at', 'updated_at'],
        // created_at is second-precision, so id breaks ties deterministically.
        order: [['created_at', 'DESC'], ['id', 'DESC']],
      });

      return res.status(200).json({
        success: true,
        business,
        total: socialNumbers.length,
        socialNumbers,
      });
    } catch (err) {
      console.error('[businessController.getSocialNumbersByBusiness] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * GET /business/social-numbers
   * Get all social numbers. Filter by ?business_id=
   */
  getSocialNumbers: async (req, res) => {
    try {
      const { business_id, phone_number, is_activated } = req.query;
      const where = {};
      if (business_id) where.business_id = business_id;
      if (phone_number) where.phone_number = { [Op.like]: `%${phone_number}%` };
      if (is_activated !== undefined) where.is_activated = is_activated === 'true' || is_activated === '1';

      const socialNumbers = await SocialNumber.findAll({
        where,
        include: [{ model: Business, as: 'business', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
      });

      return res.status(200).json({ success: true, socialNumbers });
    } catch (err) {
      console.error('[businessController.getSocialNumbers] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * GET /business/social-numbers/:id
   * Get a single social number by ID.
   */
  getSocialNumberById: async (req, res) => {
    try {
      const { id } = req.params;

      const socialNumber = await SocialNumber.findByPk(id, {
        include: [{ model: Business, as: 'business', attributes: ['id', 'name'] }],
      });

      if (!socialNumber) {
        return res.status(404).json({ success: false, message: 'Social number not found' });
      }

      return res.status(200).json({ success: true, socialNumber });
    } catch (err) {
      console.error('[businessController.getSocialNumberById] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * PUT /business/social-numbers/:id
   * Update a social number.
   */
  updateSocialNumber: async (req, res) => {
    try {
      const { id } = req.params;

      const { error, value } = socialNumberUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }
      req.body = value; // use the trimmed/coerced values below

      const socialNumber = await SocialNumber.findByPk(id);
      if (!socialNumber) {
        return res.status(404).json({ success: false, message: 'Social number not found' });
      }

      if (req.body.business_id) {
        const business = await Business.findByPk(req.body.business_id);
        if (!business) {
          return res.status(404).json({ success: false, message: 'Business not found' });
        }
      }

      // Reject a phone number already taken by another row (soft-deleted rows
      // still occupy the unique index).
      if (req.body.phone_number && req.body.phone_number !== socialNumber.phone_number) {
        const taken = await SocialNumber.findOne({
          where: { phone_number: req.body.phone_number, id: { [Op.ne]: socialNumber.id } },
          paranoid: false,
        });
        if (taken) {
          return res.status(409).json({ success: false, message: 'Phone number already in use' });
        }
      }

      await socialNumber.update(req.body);

      return res.status(200).json({
        success: true,
        message: 'Social number updated successfully',
        socialNumber,
      });
    } catch (err) {
      console.error('[businessController.updateSocialNumber] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * DELETE /business/social-numbers/:id
   * Soft-delete a social number.
   */
  deleteSocialNumber: async (req, res) => {
    try {
      const { id } = req.params;

      const socialNumber = await SocialNumber.findByPk(id);
      if (!socialNumber) {
        return res.status(404).json({ success: false, message: 'Social number not found' });
      }

      await socialNumber.destroy(); // soft-delete via paranoid

      return res.status(200).json({ success: true, message: 'Social number deleted successfully' });
    } catch (err) {
      console.error('[businessController.deleteSocialNumber] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  BUSINESS SOCIALS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /business/business-socials
   * Create a new business social account entry.
   */
  createBusinessSocial: async (req, res) => {
    try {
      const { error, value } = businessSocialCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const { business_id, type, phone, is_activated } = value;

      const business = await Business.findByPk(business_id);
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      // `phone` is UNIQUE — report the clash rather than leaking a 500.
      if (phone) {
        const taken = await BusinessSocial.findOne({ where: { phone }, paranoid: false });
        if (taken) {
          return res.status(409).json({ success: false, message: 'Phone already in use by another business social' });
        }
      }

      const businessSocial = await BusinessSocial.create({
        business_id,
        type,
        phone: phone || null,
        is_activated: is_activated ?? false,
      });

      return res.status(201).json({
        success: true,
        message: 'Business social created successfully',
        businessSocial,
      });
    } catch (err) {
      console.error('[businessController.createBusinessSocial] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * GET /business/business-socials
   * Get all business socials. Filter by ?business_id= and/or ?type=
   */
  getBusinessSocials: async (req, res) => {
    try {
      const { business_id, type } = req.query;
      const where = {};
      if (business_id) where.business_id = business_id;
      if (type) where.type = type;

      const businessSocials = await BusinessSocial.findAll({
        where,
        include: [
          { model: Business, as: 'business', attributes: ['id', 'name'] },
          socialNumbersInclude,
        ],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
      });

      return res.status(200).json({ success: true, businessSocials });
    } catch (err) {
      console.error('[businessController.getBusinessSocials] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * GET /business/business-socials/:id
   * Get a single business social by ID.
   */
  getBusinessSocialById: async (req, res) => {
    try {
      const { id } = req.params;

      const businessSocial = await BusinessSocial.findByPk(id, {
        include: [
          { model: Business, as: 'business', attributes: ['id', 'name'] },
          socialNumbersInclude,
        ],
      });

      if (!businessSocial) {
        return res.status(404).json({ success: false, message: 'Business social not found' });
      }

      return res.status(200).json({ success: true, businessSocial });
    } catch (err) {
      console.error('[businessController.getBusinessSocialById] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * PUT /business/business-socials/:id
   * Update a business social entry.
   */
  updateBusinessSocial: async (req, res) => {
    try {
      const { id } = req.params;

      const { error, value } = businessSocialUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const businessSocial = await BusinessSocial.findByPk(id);
      if (!businessSocial) {
        return res.status(404).json({ success: false, message: 'Business social not found' });
      }

      if (value.business_id) {
        const business = await Business.findByPk(value.business_id);
        if (!business) {
          return res.status(404).json({ success: false, message: 'Business not found' });
        }
      }

      if (value.phone && value.phone !== businessSocial.phone) {
        const taken = await BusinessSocial.findOne({
          where: { phone: value.phone, id: { [Op.ne]: businessSocial.id } },
          paranoid: false,
        });
        if (taken) {
          return res.status(409).json({ success: false, message: 'Phone already in use by another business social' });
        }
      }

      // Sending phone as null/'' clears it.
      if (value.phone === '') value.phone = null;

      await businessSocial.update(value);

      return res.status(200).json({
        success: true,
        message: 'Business social updated successfully',
        businessSocial,
      });
    } catch (err) {
      console.error('[businessController.updateBusinessSocial] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * DELETE /business/business-socials/:id
   * Soft-delete a business social entry.
   */
  deleteBusinessSocial: async (req, res) => {
    try {
      const { id } = req.params;

      const businessSocial = await BusinessSocial.findByPk(id);
      if (!businessSocial) {
        return res.status(404).json({ success: false, message: 'Business social not found' });
      }

      await businessSocial.destroy(); // soft-delete via paranoid

      return res.status(200).json({ success: true, message: 'Business social deleted successfully' });
    } catch (err) {
      console.error('[businessController.deleteBusinessSocial] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SYNC / UNSYNC
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /business/business-socials/:id/sync
   * Sync one or many social numbers to a business social.
   * Body: { social_number_ids: [1, 2, 3] }  (or { social_number_id: 1 })
   *
   * All-or-nothing: if any id is unknown, belongs to a different business, or
   * is already synced elsewhere, nothing is written. Ids already synced to THIS
   * business social are skipped so repeat calls stay idempotent.
   */
  syncSocialNumber: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;

      const { error, value } = syncSocialNumberSchema.validate(req.body, { abortEarly: false });
      if (error) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const ids = value.social_number_ids ?? [value.social_number_id];

      const businessSocial = await BusinessSocial.findByPk(id, { transaction: t });
      if (!businessSocial) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Business social not found' });
      }

      const socialNumbers = await SocialNumber.findAll({ where: { id: ids }, transaction: t });

      const missing = ids.filter(x => !socialNumbers.some(s => s.id === x));
      if (missing.length) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: 'Social number(s) not found',
          social_number_ids: missing,
        });
      }

      // Every number must belong to the same business as the business social.
      const foreign = socialNumbers.filter(s => s.business_id !== businessSocial.business_id).map(s => s.id);
      if (foreign.length) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Social number(s) do not belong to the same business as this business social',
          social_number_ids: foreign,
        });
      }

      // A social number can only be synced to one business social.
      const existingLinks = await BusinessSocialNumber.findAll({
        where: { social_number_id: ids },
        transaction: t,
      });

      const conflicts = existingLinks
        .filter(l => l.business_social_id !== businessSocial.id)
        .map(l => ({ social_number_id: l.social_number_id, business_social_id: l.business_social_id }));
      if (conflicts.length) {
        await t.rollback();
        return res.status(409).json({
          success: false,
          message: 'Social number(s) already synced to another business social',
          conflicts,
        });
      }

      const alreadyLinked = existingLinks.map(l => l.social_number_id);
      const toLink = ids.filter(x => !alreadyLinked.includes(x));

      if (toLink.length) {
        await BusinessSocialNumber.bulkCreate(
          toLink.map(social_number_id => ({ business_social_id: businessSocial.id, social_number_id })),
          { transaction: t }
        );
      }

      await t.commit();

      const updated = await BusinessSocial.findByPk(businessSocial.id, {
        include: [{ model: Business, as: 'business', attributes: ['id', 'name'] }, socialNumbersInclude],
      });

      return res.status(200).json({
        success: true,
        message: 'Social number(s) synced successfully',
        synced: toLink,
        skipped: alreadyLinked, // already synced to this business social
        businessSocial: updated,
      });
    } catch (err) {
      await t.rollback();
      console.error('[businessController.syncSocialNumber] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * DELETE /business/business-socials/:id/sync
   * Unsync one or many social numbers from a business social.
   * Body: { social_number_ids: [1, 2] } — omit the body to unsync all of them.
   */
  unsyncSocialNumber: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;

      const { error, value } = unsyncSocialNumberSchema.validate(req.body ?? {}, { abortEarly: false });
      if (error) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const businessSocial = await BusinessSocial.findByPk(id, { transaction: t });
      if (!businessSocial) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Business social not found' });
      }

      const requested = value.social_number_ids ?? (value.social_number_id ? [value.social_number_id] : null);

      const links = await BusinessSocialNumber.findAll({
        where: {
          business_social_id: businessSocial.id,
          ...(requested ? { social_number_id: requested } : {}),
        },
        transaction: t,
      });

      if (!links.length) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: requested
            ? 'None of the given social numbers are synced to this business social'
            : 'No social number is currently synced to this business social',
        });
      }

      // Named ids that are not actually synced here are rejected outright, so a
      // typo cannot silently unsync only part of the request.
      if (requested) {
        const notLinked = requested.filter(x => !links.some(l => l.social_number_id === x));
        if (notLinked.length) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: 'Social number(s) not synced to this business social',
            social_number_ids: notLinked,
          });
        }
      }

      const removed = links.map(l => l.social_number_id);
      await BusinessSocialNumber.destroy({
        where: { business_social_id: businessSocial.id, social_number_id: removed },
        transaction: t,
      });

      await t.commit();

      const updated = await BusinessSocial.findByPk(businessSocial.id, {
        include: [{ model: Business, as: 'business', attributes: ['id', 'name'] }, socialNumbersInclude],
      });

      return res.status(200).json({
        success: true,
        message: 'Social number(s) unsynced successfully',
        unsynced: removed,
        businessSocial: updated,
      });
    } catch (err) {
      await t.rollback();
      console.error('[businessController.unsyncSocialNumber] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },
};
