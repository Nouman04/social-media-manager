'use strict';

const express = require('express');
const router = express.Router();
const countryController = require('../controllers/countryController');
const authenticate = require('../middleware/authenticate');

router.get('/', authenticate, countryController.getCountries);

module.exports = router;
