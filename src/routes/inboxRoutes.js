'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const authorizeBusiness = require('../middleware/authorizeBusiness');
const ctrl = require('../controllers/inboxController');

// business_uuid in the query for GET, in the body otherwise.
router.use(authenticate, authorizeBusiness.byUuid);

router.get('/conversations', ctrl.list);
router.get('/counts', ctrl.counts);
router.post('/read-all', ctrl.readAll);
router.post('/conversations/bulk', ctrl.bulk);

router.get('/conversations/:id', ctrl.get);
router.patch('/conversations/:id', ctrl.update);
router.get('/conversations/:id/messages', ctrl.messages);
router.post('/conversations/:id/read', ctrl.read);
router.post('/conversations/:id/unread', ctrl.unread);
router.get('/conversations/:id/notes', ctrl.notes);
router.post('/conversations/:id/notes', ctrl.addNote);
router.get('/conversations/:id/activity', ctrl.activity);

module.exports = router;
