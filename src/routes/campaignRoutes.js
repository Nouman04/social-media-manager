'use strict';

const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const authenticate = require('../middleware/authenticate');
const authorizeBusiness = require('../middleware/authorizeBusiness');

// WhatsApp template campaigns. Every route needs a signed-in member of the
// business in business_id (body for POST, query for GET).
router.use(authenticate, authorizeBusiness);

/** POST /api/v1/campaigns/audience-preview — opted-in count + sample. */
router.post('/audience-preview', campaignController.previewAudience);

/** POST /api/v1/campaigns/send-text — free-form text to ≤ 50 chosen contacts. */
router.post('/send-text', campaignController.sendText);

/** GET /api/v1/campaigns — list. POST /api/v1/campaigns — create a draft. */
router.get('/', campaignController.listCampaigns);
router.post('/', campaignController.createCampaign);

/** GET /api/v1/campaigns/:id — campaign + delivery funnel. */
router.get('/:id', campaignController.getCampaign);

/** POST /api/v1/campaigns/:id/send — start (or resume) sending. */
router.post('/:id/send', campaignController.sendCampaign);

/** GET /api/v1/campaigns/:id/recipients — per-recipient results. */
router.get('/:id/recipients', campaignController.getRecipients);

module.exports = router;
