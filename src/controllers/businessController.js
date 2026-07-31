'use strict';

const { Business, BusinessSocial, SocialNumber } = require('../../models');
const {
  socialNumberCreateSchema,
  socialNumberUpdateSchema,
  businessSocialCreateSchema,
  businessSocialUpdateSchema,
  syncSocialNumberSchema,
} = require('../validations/businessValidation');

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  SOCIAL NUMBERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /business/social-numbers
   * Create a new social number linked to a business.
   */
  createSocialNumber: async (req, res) => {
    try {
      const { error } = socialNumberCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const { business_id, is_activated } = req.body;

      const business = await Business.findByPk(business_id);
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      const socialNumber = await SocialNumber.create({ business_id, is_activated: is_activated ?? false });

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
   * GET /business/social-numbers
   * Get all social numbers. Filter by ?business_id=
   */
  getSocialNumbers: async (req, res) => {
    try {
      const { business_id } = req.query;
      const where = business_id ? { business_id } : {};

      const socialNumbers = await SocialNumber.findAll({
        where,
        include: [{ model: Business, as: 'business', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']],
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

      const { error } = socialNumberUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

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
      const { error } = businessSocialCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const { business_id, type, business_number, is_activated } = req.body;

      const business = await Business.findByPk(business_id);
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      if (business_number) {
        const socialNumber = await SocialNumber.findByPk(business_number);
        if (!socialNumber) {
          return res.status(404).json({ success: false, message: 'Social number not found' });
        }
      }

      const businessSocial = await BusinessSocial.create({
        business_id,
        type,
        business_number: business_number ?? null,
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
          { model: SocialNumber, as: 'socialNumber', attributes: ['id', 'is_activated'] },
        ],
        order: [['created_at', 'DESC']],
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
          { model: SocialNumber, as: 'socialNumber', attributes: ['id', 'is_activated'] },
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

      const { error } = businessSocialUpdateSchema.validate(req.body, { abortEarly: false });
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

      if (req.body.business_id) {
        const business = await Business.findByPk(req.body.business_id);
        if (!business) {
          return res.status(404).json({ success: false, message: 'Business not found' });
        }
      }

      if (req.body.business_number) {
        const socialNumber = await SocialNumber.findByPk(req.body.business_number);
        if (!socialNumber) {
          return res.status(404).json({ success: false, message: 'Social number not found' });
        }
      }

      await businessSocial.update(req.body);

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
   * Link a SocialNumber to a BusinessSocial (set business_number FK).
   * Body: { social_number_id }
   */
  syncSocialNumber: async (req, res) => {
    try {
      const { id } = req.params;

      const { error } = syncSocialNumberSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const { social_number_id } = req.body;

      const businessSocial = await BusinessSocial.findByPk(id);
      if (!businessSocial) {
        return res.status(404).json({ success: false, message: 'Business social not found' });
      }

      const socialNumber = await SocialNumber.findByPk(social_number_id);
      if (!socialNumber) {
        return res.status(404).json({ success: false, message: 'Social number not found' });
      }

      // Ensure the social number belongs to the same business
      if (socialNumber.business_id !== businessSocial.business_id) {
        return res.status(400).json({
          success: false,
          message: 'Social number does not belong to the same business as this business social',
        });
      }

      await businessSocial.update({ business_number: social_number_id });

      return res.status(200).json({
        success: true,
        message: 'Social number synced successfully',
        businessSocial,
      });
    } catch (err) {
      console.error('[businessController.syncSocialNumber] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  /**
   * DELETE /business/business-socials/:id/sync
   * Unlink the SocialNumber from a BusinessSocial (set business_number to null).
   */
  unsyncSocialNumber: async (req, res) => {
    try {
      const { id } = req.params;

      const businessSocial = await BusinessSocial.findByPk(id);
      if (!businessSocial) {
        return res.status(404).json({ success: false, message: 'Business social not found' });
      }

      if (!businessSocial.business_number) {
        return res.status(400).json({
          success: false,
          message: 'No social number is currently synced to this business social',
        });
      }

      await businessSocial.update({ business_number: null });

      return res.status(200).json({
        success: true,
        message: 'Social number unsynced successfully',
        businessSocial,
      });
    } catch (err) {
      console.error('[businessController.unsyncSocialNumber] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },
};
