'use strict';

/** Run after `authenticate`. Lets only users holding the super_admin role through. */
const requireSuperAdmin = async (req, res, next) => {
  try {
    const roles = await req.user.getRoles({ attributes: ['name'], joinTableAttributes: [] });
    if (!roles.some(r => r.name === 'super_admin')) {
      return res.status(403).json({ success: false, message: 'Forbidden: Super Admin only' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = requireSuperAdmin;
