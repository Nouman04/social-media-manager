'use strict';

/**
 * Demo data for the Unified Inbox and Dashboard, on the first business owned
 * by alice@example.com (run the demo-users seeder and create a business first).
 *
 *  - bilal@example.com joins that business as an agent (per-user unread check)
 *  - 3 conversations (WhatsApp, Instagram, Messenger) with inbound + outbound messages
 *
 * Messages go through the models so the inbox hooks fill last_message_at /
 * unread state exactly as live traffic would. Safe to re-run.
 *   npm run seed:one -- 20261114100000-demo-inbox-seeder.js
 */
const DEMO_IDS = ['923001112233', '17841400000000001', '24000000000000001'];

module.exports = {
  up: async () => {
    const db = require('../models');
    const { User, Business, BusinessUser, Conversation, WhatsappMessage, InstagramMessage, MessengerMessage, SocialPlatform } = db;

    const alice = await User.findOne({ where: { email: 'alice@example.com' } });
    const bilal = await User.findOne({ where: { email: 'bilal@example.com' } });
    if (!alice || !bilal) throw new Error('Run the demo-verified-users seeder first');
    const business = await Business.findOne({ where: { created_by: alice.id }, order: [['id', 'ASC']] });
    if (!business) throw new Error('Create a business for alice@example.com first (POST /business)');

    for (const [user, owner] of [[alice, true], [bilal, false]]) {
      const [link] = await BusinessUser.findOrCreate({
        where: { business_id: business.id, user_id: user.id },
        defaults: { business_id: business.id, user_id: user.id, is_owner: owner, is_active: true },
      });
      if (!link.is_active) await link.update({ is_active: true });
    }

    const pid = async (name) => (await SocialPlatform.findOne({ where: { name } })).id;
    const ago = (min) => new Date(Date.now() - min * 60 * 1000);

    const threads = [
      {
        platform: 'whatsapp', id: DEMO_IDS[0], name: 'Muhammad Bilal', Model: WhatsappMessage,
        msgs: [
          ['inbound', 'text', { from: DEMO_IDS[0], type: 'text', text: { body: 'Assalam o alaikum, appointment chahiye' } }, 300],
          ['outbound', 'text', { to: DEMO_IDS[0], type: 'text', text: { body: 'Walaikum salam! Kal 11 baje theek hai?' } }, 296],
          ['inbound', 'text', { from: DEMO_IDS[0], type: 'text', text: { body: 'Price kya hai?' } }, 20],
        ],
      },
      {
        platform: 'instagram', id: DEMO_IDS[1], name: 'ibn.etariq', Model: InstagramMessage,
        msgs: [
          ['inbound', 'text', { message: { mid: 'demo-ig-1', text: 'Do you deliver to Lahore?' } }, 120],
          ['inbound', 'image', { message: { mid: 'demo-ig-2', attachments: [{ type: 'image', payload: { url: 'https://picsum.photos/200' } }] } }, 119],
        ],
      },
      {
        platform: 'messenger', id: DEMO_IDS[2], name: 'Sara Khan', Model: MessengerMessage,
        msgs: [
          ['inbound', 'text', { message: { mid: 'demo-fb-1', text: 'Hi, is the clinic open on Sunday?' } }, 60],
          ['outbound', 'text', { recipient: { id: DEMO_IDS[2] }, message: { text: 'Yes, 10am to 2pm.' } }, 55],
        ],
      },
    ];

    for (const t of threads) {
      const where = { business_id: business.id, social_platform_id: await pid(t.platform), contact_identifier: t.id };
      if (await Conversation.findOne({ where })) continue; // already seeded
      const conv = await Conversation.create({
        ...where, account_id: null, contact_name: t.name, type: 'private', created_by: alice.id, created_at: ago(t.msgs[0][3] + 1),
      });
      for (const [direction, message_type, payload, minAgo] of t.msgs) {
        await t.Model.create({
          conversation_id: conv.id, direction, message_type, payload,
          status: direction === 'inbound' ? 'delivered' : 'read',
          sender_id: direction === 'outbound' ? alice.id : null,
          created_at: ago(minAgo), updated_at: ago(minAgo),
        });
      }
    }
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('conversations', { contact_identifier: DEMO_IDS });
  },
};
