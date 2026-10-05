'use strict';

const { User } = require('../../models');

module.exports = {
  getProfile: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.id, {
        attributes: ['id', 'uuid', 'name', 'email', 'phone', 'avatar', 'timezone', 'locale', 'status', 'email_verified_at'],
      });

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      return res.status(200).json({ success: true, profile: user });
    } catch (err) {
      console.error('[userController.getProfile] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  updateProfile: async (req, res) => {
    try {
      const { name, phone, avatar, timezone, locale } = req.body;
      
      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      await user.update({
        name: name !== undefined ? name : user.name,
        phone: phone !== undefined ? phone : user.phone,
        avatar: avatar !== undefined ? avatar : user.avatar,
        timezone: timezone !== undefined ? timezone : user.timezone,
        locale: locale !== undefined ? locale : user.locale,
      });

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        profile: {
          id: user.id,
          uuid: user.uuid,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar,
          timezone: user.timezone,
          locale: user.locale,
          status: user.status,
        }
      });
    } catch (err) {
      console.error('[userController.updateProfile] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  }
};
