'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const authorizeBusiness = require('../middleware/authorizeBusiness');
const ctrl = require('../controllers/inboxController');

// business_uuid in the query for GET/DELETE, in the body otherwise.
router.use(authenticate, authorizeBusiness.byUuid);

router.get('/', ctrl.listTags);
router.post('/', ctrl.createTag);
router.put('/:uuid', ctrl.updateTag);
router.delete('/:uuid', ctrl.deleteTag);

module.exports = router;
