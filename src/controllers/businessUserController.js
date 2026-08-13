'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, Business, BusinessUser, sequelize } = require('../../models');
const { sendInvitationEmail } = require('../helpers/mailService');
const {
  inviteUserSchema,
  acceptInvitationSchema,
  resendInvitationSchema,
} = require('../validations/businessUserValidation');

// How long an invitation link stays usable.
const INVITATION_TTL_HOURS = parseInt(process.env.INVITATION_TTL_HOURS || '48', 10);

/** Generate a single-use invitation token. */
const generateInvitationToken = () => crypto.randomBytes(48).toString('hex');

/** Build the invitation URL the invitee will open. */
const buildInvitationLink = (uuid, token) => {
  const base = (process.env.APP_FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/accept-invitation?uuid=${encodeURIComponent(uuid)}&token=${encodeURIComponent(token)}`;
};

/** Issue a fresh token + expiry on a user record. */
const issueInvitation = async (user, transaction = null) => {
  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

  await user.update(
    { authentication_token: token, invitation_expired_at: expiresAt },
    transaction ? { transaction } : {}
  );

  return { token, expiresAt };
};

/**
 * Confirm the acting user owns (or actively belongs to) the business.
 * Returns the BusinessUser row, or null when they don't.
 */
const getActiveMembership = async (businessId, userId) =>
  BusinessUser.findOne({ where: { business_id: businessId, user_id: userId, is_active: true } });

const fail = (res, err, context) => {
  console.error(`[businessUserController.${context}] Error:`, err.message);
  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.statusCode ? err.message : 'Internal server error',
    ...(err.statusCode ? {} : { error: err.message }),
  });
};

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  1. INVITE A USER TO A BUSINESS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /business-users/invite
   *
   * The business owner creates a user and an invitation link is emailed to
   * them. The user is created inactive with no password — they set one by
   * opening the link.
   *
   * Body: { business_id, email, name? }
   */
  inviteUser: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { error } = inviteUserSchema.validate(req.body, { abortEarly: false });
      if (error) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
      }

      const { business_id, email, name } = req.body;

      const business = await Business.findByPk(business_id, { transaction: t });
      if (!business) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      // Only an active member of the business may invite others.
      const actingMembership = await getActiveMembership(business_id, req.user.id);
      if (!actingMembership) {
        await t.rollback();
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this business',
        });
      }

      let user = await User.findOne({ where: { email }, transaction: t });

      if (user) {
        // Existing account — check they aren't already on this business.
        const existingLink = await BusinessUser.findOne({
          where: { business_id, user_id: user.id },
          paranoid: false,
          transaction: t,
        });

        if (existingLink && existingLink.is_active) {
          await t.rollback();
          return res.status(409).json({
            success: false,
            message: 'This user is already a member of the business',
          });
        }

        if (existingLink) {
          // Previously removed — re-activate rather than duplicating the row.
          await existingLink.update(
            { is_active: true, invited_by: req.user.id },
            { transaction: t }
          );
        } else {
          await BusinessUser.create({
            business_id,
            user_id: user.id,
            is_owner: false,
            is_active: true,
            invited_by: req.user.id,
          }, { transaction: t });
        }
      } else {
        // Brand-new account: no password until they accept the invitation.
        user = await User.create({
          name: name || null,
          email,
          password: null,
          status: 'inactive',
        }, { transaction: t });

        await BusinessUser.create({
          business_id,
          user_id: user.id,
          is_owner: false,
          is_active: true,
          invited_by: req.user.id,
        }, { transaction: t });
      }

      // Users who never set a password still need an invitation link.
      const needsInvitation = !user.password;
      let invitation = null;
      if (needsInvitation) {
        invitation = await issueInvitation(user, t);
      }

      await t.commit();

      if (invitation) {
        const link = buildInvitationLink(user.uuid, invitation.token);
        await sendInvitationEmail(
          user.email,
          link,
          business.name,
          req.user.name || req.user.email,
          INVITATION_TTL_HOURS
        );
      }

      return res.status(201).json({
        success: true,
        message: needsInvitation
          ? 'User invited successfully. An invitation link has been emailed to them.'
          : 'Existing user added to the business.',
        user: {
          id: user.id,
          uuid: user.uuid,
          name: user.name,
          email: user.email,
          status: user.status,
        },
        ...(invitation && { invitation_expired_at: invitation.expiresAt }),
      });
    } catch (err) {
      if (!t.finished) await t.rollback();
      return fail(res, err, 'inviteUser');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  2. ACCEPT AN INVITATION (set password → verified + active + logged in)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /business-users/accept-invitation
   *
   * Public: the invitee is not logged in yet. Validates the uuid + token pair
   * from the link, sets the password, marks the account active and verified,
   * burns the token, and returns a JWT so they land logged in.
   *
   * Body: { uuid, token, password }
   */
  acceptInvitation: async (req, res) => {
    try {
      const { error } = acceptInvitationSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
      }

      const { uuid, token, password } = req.body;

      const user = await User.findOne({ where: { uuid } });
      if (!user || !user.authentication_token) {
        return res.status(400).json({ success: false, message: 'Invalid or already-used invitation link' });
      }

      // Constant-time compare so a wrong token can't be guessed by timing.
      const provided = Buffer.from(String(token));
      const expected = Buffer.from(String(user.authentication_token));
      const tokenMatches =
        provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

      if (!tokenMatches) {
        return res.status(400).json({ success: false, message: 'Invalid or already-used invitation link' });
      }

      if (!user.invitation_expired_at || new Date() > new Date(user.invitation_expired_at)) {
        return res.status(410).json({
          success: false,
          message: 'This invitation link has expired. Please request a new one.',
          expired: true,
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await user.update({
        password: hashedPassword,
        status: 'active',
        email_verified_at: new Date(),
        // Burn the invitation so the link cannot be replayed.
        authentication_token: null,
        invitation_expired_at: null,
      });

      const memberships = await BusinessUser.findAll({
        where: { user_id: user.id, is_active: true },
        include: [{ model: Business, as: 'business', attributes: ['id', 'name', 'is_active'] }],
      });

      const jwtToken = jwt.sign(
        { id: user.id, email: user.email },
        process.env.NODE_SECRET_KEY || 'smm_secret_key',
        { expiresIn: '24h' }
      );

      return res.status(200).json({
        success: true,
        message: 'Invitation accepted. Your account is now active and verified.',
        token: jwtToken,
        user: {
          id: user.id,
          uuid: user.uuid,
          name: user.name,
          email: user.email,
          status: user.status,
          businesses: memberships.map((m) => ({
            id: m.business?.id,
            name: m.business?.name,
            is_owner: m.is_owner,
          })),
        },
      });
    } catch (err) {
      return fail(res, err, 'acceptInvitation');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3. RESEND AN INVITATION (after the link expired)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /business-users/resend-invitation
   *
   * Public: the invitee still can't log in, so this can't require a JWT.
   * Issues a fresh token + expiry and emails a new link.
   *
   * Body: { email }
   */
  resendInvitation: async (req, res) => {
    try {
      const { error } = resendInvitationSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
      }

      const { email } = req.body;

      // Always answer the same way so this can't be used to discover which
      // email addresses exist in the system.
      const genericResponse = {
        success: true,
        message: 'If that email has a pending invitation, a new link has been sent.',
      };

      const user = await User.findOne({ where: { email } });
      if (!user || user.password) {
        // No such user, or they already completed setup — nothing to resend.
        return res.status(200).json(genericResponse);
      }

      const membership = await BusinessUser.findOne({
        where: { user_id: user.id, is_active: true },
        include: [{ model: Business, as: 'business', attributes: ['id', 'name'] }],
      });

      if (!membership) {
        return res.status(200).json(genericResponse);
      }

      const { token } = await issueInvitation(user);
      const link = buildInvitationLink(user.uuid, token);

      await sendInvitationEmail(
        user.email,
        link,
        membership.business?.name || 'your business',
        'The business owner',
        INVITATION_TTL_HOURS
      );

      return res.status(200).json(genericResponse);
    } catch (err) {
      return fail(res, err, 'resendInvitation');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  4. LIST BUSINESS USERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /business-users?business_id=&include_inactive=&limit=&offset=
   *
   * Lists the users attached to a business. Removed users (is_active = 0) are
   * hidden unless include_inactive=true.
   */
  getBusinessUsers: async (req, res) => {
    try {
      const { business_id, include_inactive, limit = 50, offset = 0 } = req.query;

      if (!business_id) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: ['business_id is required'],
        });
      }

      const business = await Business.findByPk(business_id);
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      const actingMembership = await getActiveMembership(business_id, req.user.id);
      if (!actingMembership) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this business',
        });
      }

      const where = { business_id };
      if (include_inactive !== 'true') where.is_active = true;

      const { rows, count } = await BusinessUser.findAndCountAll({
        where,
        include: [{
          model: User,
          as: 'user',
          attributes: [
            'id', 'uuid', 'name', 'email', 'status',
            'email_verified_at', 'authentication_token', 'invitation_expired_at',
          ],
        }],
        order: [['is_owner', 'DESC'], ['created_at', 'ASC']],
        limit: Number(limit),
        offset: Number(offset),
      });

      const users = rows.map((link) => {
        const u = link.user;

        // An outstanding token means the invite hasn't been accepted yet.
        // Accepting burns the token, so its absence means there is nothing
        // pending — which is also true of owners, who are never invited.
        let invitationStatus = 'ACCEPTED';
        if (u?.authentication_token) {
          const expired = u.invitation_expired_at && new Date() > new Date(u.invitation_expired_at);
          invitationStatus = expired ? 'EXPIRED' : 'PENDING';
        }

        return {
          id: u?.id,
          uuid: u?.uuid,
          name: u?.name,
          email: u?.email,
          status: u?.status,
          is_owner: link.is_owner,
          is_active: link.is_active,
          invitation_status: invitationStatus,
          invitation_expired_at: u?.invitation_expired_at || null,
          joined_at: link.created_at,
        };
      });

      return res.status(200).json({
        success: true,
        business: { id: business.id, name: business.name, is_active: business.is_active },
        total: count,
        limit: Number(limit),
        offset: Number(offset),
        users,
      });
    } catch (err) {
      return fail(res, err, 'getBusinessUsers');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  5. REMOVE A USER FROM A BUSINESS (is_active → 0)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * DELETE /business-users?business_id=&user_id=
   *
   * Soft removal: the pivot row is kept and is_active set to 0, so the
   * membership history survives and the user can be re-invited later.
   */
  removeBusinessUser: async (req, res) => {
    try {
      const { business_id, user_id } = req.query;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!user_id) missing.push('user_id is required');
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const actingMembership = await getActiveMembership(business_id, req.user.id);
      if (!actingMembership) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this business',
        });
      }

      const link = await BusinessUser.findOne({ where: { business_id, user_id } });
      if (!link) {
        return res.status(404).json({ success: false, message: 'User is not a member of this business' });
      }

      // The business would be left without an owner otherwise.
      if (link.is_owner) {
        return res.status(400).json({
          success: false,
          message: 'The business owner cannot be removed',
        });
      }

      if (!link.is_active) {
        return res.status(200).json({
          success: true,
          message: 'User was already removed from this business',
        });
      }

      await link.update({ is_active: false });

      return res.status(200).json({
        success: true,
        message: 'User removed from the business successfully',
        membership: {
          business_id: link.business_id,
          user_id: link.user_id,
          is_active: link.is_active,
        },
      });
    } catch (err) {
      return fail(res, err, 'removeBusinessUser');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  6. RESTORE A REMOVED USER (is_active → 1)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * PUT /business-users/restore
   * Body: { business_id, user_id }
   */
  restoreBusinessUser: async (req, res) => {
    try {
      const { business_id, user_id } = req.body;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!user_id) missing.push('user_id is required');
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const actingMembership = await getActiveMembership(business_id, req.user.id);
      if (!actingMembership) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this business',
        });
      }

      const link = await BusinessUser.findOne({ where: { business_id, user_id } });
      if (!link) {
        return res.status(404).json({ success: false, message: 'No membership record found for this user' });
      }

      await link.update({ is_active: true });

      return res.status(200).json({
        success: true,
        message: 'User restored to the business successfully',
        membership: {
          business_id: link.business_id,
          user_id: link.user_id,
          is_active: link.is_active,
        },
      });
    } catch (err) {
      return fail(res, err, 'restoreBusinessUser');
    }
  },
};
