'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();
const socialPostController = require('../controllers/socialPostController');
const authenticate = require('../middleware/authenticate');
const authorizeBusiness = require('../middleware/authorizeBusiness');

/**
 * GET /api/v1/posts/manage
 * Public: serves the posts & comments page. The page signs in itself and
 * calls the protected APIs below with a JWT.
 */
router.get('/manage', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/posts.html'));
});

// Every route below needs a signed-in member of the business in business_id.
router.use(authenticate, authorizeBusiness);

/**
 * GET /api/v1/posts?business_id=&platform=instagram|facebook&account_id=&filter=&after=
 * Posts of a connected Instagram account / Facebook Page with comment and
 * reaction counts. filter: all | commented | uncommented.
 */
router.get('/', socialPostController.listPosts);

/**
 * POST /api/v1/posts/comments
 * Comment on a post (target: post) or reply to a comment (target: comment).
 */
router.post('/comments', socialPostController.comment);

/**
 * POST /api/v1/posts/reactions
 * Like / unlike a Facebook post or comment as the Page.
 */
router.post('/reactions', socialPostController.react);

/**
 * GET /api/v1/posts/:postId/comments?business_id=&platform=&account_id=&after=
 * Comments (with replies) on one post.
 */
router.get('/:postId/comments', socialPostController.listComments);

module.exports = router;
