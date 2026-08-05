const express = require('express');
const router = express.Router();
const businessController = require('../controllers/businessController');
const passport = require('passport');

router.use((req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    req.user = user;
    next();
  })(req, res, next);
});

// ─── Social Numbers ───────────────────────────────────────────────────────────
router.post('/social-numbers', businessController.createSocialNumber);
router.get('/social-numbers', businessController.getSocialNumbers);
router.get('/social-numbers/:id', businessController.getSocialNumberById);
router.put('/social-numbers/:id', businessController.updateSocialNumber);
router.delete('/social-numbers/:id', businessController.deleteSocialNumber);

// ─── Business Socials ─────────────────────────────────────────────────────────
router.post('/business-socials', businessController.createBusinessSocial);
router.get('/business-socials', businessController.getBusinessSocials);
router.get('/business-socials/:id', businessController.getBusinessSocialById);
router.put('/business-socials/:id', businessController.updateBusinessSocial);
router.delete('/business-socials/:id', businessController.deleteBusinessSocial);

// ─── Sync / Unsync Social Number ─────────────────────────────────────────────
router.post('/business-socials/:id/sync', businessController.syncSocialNumber);
router.delete('/business-socials/:id/sync', businessController.unsyncSocialNumber);

// ─── Businesses ───────────────────────────────────────────────────────────────
// NOTE: the `/:id` routes are declared at the bottom of this file so the static
// `/social-numbers` and `/business-socials` paths are matched first.
router.post('/', businessController.createBusiness);
router.get('/', businessController.getBusinesses);
router.get('/:businessId/social-numbers', businessController.getSocialNumbersByBusiness);
router.get('/:id', businessController.getBusinessById);
router.put('/:id', businessController.updateBusiness);
router.delete('/:id', businessController.deleteBusiness);

module.exports = router;
