'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();
const contactController = require('../controllers/contactController');
const authenticate = require('../middleware/authenticate');
const authorizeBusiness = require('../middleware/authorizeBusiness');

/**
 * GET /api/v1/contacts/manage
 * Public: serves the contacts page (add, Excel/CSV import, list). The page
 * signs in itself and calls the protected APIs below with a JWT.
 */
router.get('/manage', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/contacts.html'));
});

// Every route below needs a signed-in member of the business in business_id.
router.use(authenticate, authorizeBusiness);

/**
 * GET /api/v1/contacts/channel-users?business_id=&platform=&account_id=&search=
 * Everyone who messaged any connected WhatsApp / Instagram / Messenger account.
 */
router.get('/channel-users', contactController.listChannelUsers);

/**
 * POST /api/v1/contacts/import
 * Body: { business_id, rows: [...], consent_confirmed?, default_country_code? }
 */
router.post('/import', contactController.importContacts);

/**
 * GET  /api/v1/contacts?business_id=&search=&tag=&consent=
 * POST /api/v1/contacts  Body: { business_id, phone, name?, email?, tags?, whatsapp_consent? }
 */
router.get('/', contactController.listContacts);
router.post('/', contactController.createContact);

/**
 * PATCH  /api/v1/contacts/:id  Body: { business_id, name?, email?, tags?, whatsapp_consent? }
 * DELETE /api/v1/contacts/:id?business_id=
 */
router.patch('/:id', contactController.updateContact);
router.delete('/:id', contactController.deleteContact);

module.exports = router;
