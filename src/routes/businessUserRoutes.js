'use strict';

const express = require('express');
const router = express.Router();
const businessUserController = require('../controllers/businessUserController');
const authenticate = require('../middleware/authenticate');

// ─── PUBLIC ROUTES (no JWT) ───────────────────────────────────────────────────
// The invitee has no account yet — they cannot hold a token at this point.
// These MUST be registered before the JWT middleware below.

/**
 * POST /business-users/accept-invitation
 * Open the invitation link, set a password, and get logged in.
 * Body: { uuid, token, password }
 */
router.post('/accept-invitation', businessUserController.acceptInvitation);

/**
 * POST /business-users/resend-invitation
 * Request a fresh invitation link after the previous one expired.
 * Body: { email }
 */
router.post('/resend-invitation', businessUserController.resendInvitation);

// ─── JWT Auth Middleware ───────────────────────────────────────────────────────
// Applied only to the routes defined AFTER this block.
// Unauthenticated / invalid-token requests are rejected with 401 here.
router.use(authenticate);

// ─── PROTECTED ROUTES (require valid JWT) ─────────────────────────────────────

/**
 * POST /business-users/invite
 * Business owner creates a user and emails them an invitation link.
 * Body: { business_id, email, name? }
 */
router.post('/invite', businessUserController.inviteUser);

/**
 * GET /business-users?business_id=&include_inactive=&limit=&offset=
 * List the users attached to a business.
 */
router.get('/', businessUserController.getBusinessUsers);

/**
 * DELETE /business-users?business_id=&user_id=
 * Remove a user from the business — sets is_active = 0 on the pivot row.
 */
router.delete('/', businessUserController.removeBusinessUser);

/**
 * PUT /business-users/restore
 * Restore a previously removed user — sets is_active = 1.
 * Body: { business_id, user_id }
 */
router.put('/restore', businessUserController.restoreBusinessUser);

module.exports = router;
