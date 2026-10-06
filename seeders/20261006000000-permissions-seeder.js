'use strict';

// Permission catalog, naming scheme <module>.<action>. The permissions table
// only stores `name`, so the module grouping lives here as the object keys.
const PERMISSIONS = {
  account: ['profile.view', 'profile.edit', 'account.change_password', 'account.manage_2fa'],
  company: ['company.view', 'company.edit', 'company.delete'],
  workspace: [
    'workspace.view', 'workspace.create', 'workspace.edit', 'workspace.archive', 'workspace.restore',
    'workspace.manage_ai_limit',
  ],
  team: [
    'team.view', 'team.invite', 'team.invite.resend', 'team.invite.revoke', 'team.member.remove',
    'team.member.deactivate', 'team.member.restore', 'team.member.add_to_workspace',
    'team.member.remove_from_workspace', 'team.seats.view',
  ],
  rbac: [
    'roles.view', 'roles.create', 'roles.edit', 'roles.delete', 'roles.assign',
    'permissions.view', 'permissions.create', 'permissions.edit', 'permissions.delete', 'permissions.assign',
  ],
  billing: [
    'billing.view', 'plans.view', 'plans.create', 'plans.edit', 'plans.delete', 'subscription.create',
    'subscription.update', 'subscription.cancel', 'billing.add_seat', 'invoices.view', 'invoices.download',
    'payment.submit_proof', 'payment.review',
  ],
  channels: [
    'channels.view', 'channels.whatsapp.connect', 'channels.whatsapp.disconnect',
    'channels.instagram.connect', 'channels.instagram.disconnect', 'channels.messenger.connect',
    'channels.messenger.disconnect', 'social_numbers.view', 'social_numbers.create', 'social_numbers.edit',
    'social_numbers.delete', 'business_socials.view', 'business_socials.create', 'business_socials.edit',
    'business_socials.delete', 'business_socials.sync',
  ],
  inbox: [
    'inbox.view', 'inbox.whatsapp.view', 'inbox.instagram.view', 'inbox.messenger.view', 'inbox.send_text',
    'inbox.send_media', 'inbox.send_template', 'inbox.send_quick_replies', 'inbox.send_reaction',
    'inbox.sender_action', 'inbox.assign', 'inbox.reassign', 'inbox.change_status', 'inbox.add_note',
    'inbox.mention', 'inbox.saved_replies.use', 'inbox.saved_replies.manage', 'inbox.export',
  ],
  contacts: [
    'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.import',
    'contacts.export', 'contacts.merge', 'contacts.tags.manage', 'contacts.fields.manage',
    'contacts.consent.manage', 'segments.view', 'segments.create', 'segments.edit', 'segments.delete',
  ],
  pipeline: [
    'pipeline.view', 'pipeline.create', 'pipeline.edit', 'pipeline.delete', 'deals.view', 'deals.create',
    'deals.edit', 'deals.delete', 'deals.move_stage', 'leads.allocate',
  ],
  tasks: ['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.complete', 'tasks.delete'],
  templates: [
    'templates.view', 'templates.create', 'templates.edit', 'templates.delete', 'templates.submit',
  ],
  broadcasts: ['broadcasts.view', 'broadcasts.create', 'broadcasts.send', 'broadcasts.schedule'],
  campaigns: [
    'campaigns.view', 'campaigns.create', 'campaigns.edit', 'campaigns.delete', 'campaigns.reports.view',
    'optin.manage',
  ],
  automation: [
    'automation.view', 'automation.create', 'automation.edit', 'automation.delete', 'automation.publish',
    'flows.view', 'flows.create', 'flows.edit', 'flows.delete', 'flows.publish',
  ],
  ai: [
    'ai.view', 'ai.toggle', 'ai.playbook.view', 'ai.playbook.create', 'ai.playbook.edit',
    'ai.playbook.publish', 'ai.playbook.rollback', 'ai.guardrails.manage', 'ai.knowledge_base.manage',
    'ai.handoff.manage', 'ai.sandbox.use', 'ai.memory.view', 'ai.memory.edit', 'ai.usage.view',
  ],
  commerce: [
    'commerce.view', 'commerce.connect', 'orders.view', 'orders.send_updates', 'cod.manage',
    'cart_recovery.manage', 'catalog.manage',
  ],
  tickets: [
    'tickets.view', 'tickets.create', 'tickets.edit', 'tickets.assign', 'tickets.close',
    'tickets.categories.manage', 'csat.view',
  ],
  booking: [
    'booking.view', 'booking.create', 'booking.edit', 'booking.cancel', 'booking.services.manage',
    'booking.staff.manage', 'booking.availability.manage',
  ],
  analytics: [
    'dashboard.view', 'analytics.inbox.view', 'analytics.ai.view', 'analytics.agents.view',
    'analytics.revenue.view', 'analytics.export', 'audit.view',
  ],
  settings: [
    'settings.view', 'settings.edit', 'settings.business_hours.manage', 'settings.data_privacy.manage',
    'integrations.view', 'integrations.manage', 'api_keys.view', 'api_keys.create', 'api_keys.revoke',
    'webhooks.manage',
  ],
};

const NAMES = Object.values(PERMISSIONS).flat();

module.exports = {
  // Insert-only: names already in the table are left alone, so re-running is safe.
  up: async (queryInterface) => {
    const [existing] = await queryInterface.sequelize.query('SELECT name FROM permissions');
    const have = new Set(existing.map((r) => r.name));
    const now = new Date();
    const rows = NAMES.filter((name) => !have.has(name)).map((name) => ({
      name,
      created_at: now,
      updated_at: now,
    }));
    if (rows.length) await queryInterface.bulkInsert('permissions', rows);
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('permissions', { name: NAMES });
  },
};
