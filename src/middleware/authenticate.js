'use strict';

const passport = require('passport');

/**
 * JWT authentication guard.
 *
 * Rejects the request with 401 when no token is supplied, the token is
 * invalid/expired, or the user it points at no longer exists. Only sets
 * req.user and continues when a real user was resolved.
 *
 * NOTE: passport.authenticate() with a custom callback does NOT send a 401
 * on its own — the callback owns that decision. Calling next() unconditionally
 * here would let unauthenticated requests through.
 */
const authenticate = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: a valid Bearer token is required',
        ...(info?.message && { details: info.message }),
      });
    }

    req.user = user;
    return next();
  })(req, res, next);
};

module.exports = authenticate;
