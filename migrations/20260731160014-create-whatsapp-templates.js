'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('whatsapp_templates', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      // ── Tenant linkage ────────────────────────────────────────────────────
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Tenant that owns this template',
      },

      // ── Meta identifiers ─────────────────────────────────────────────────
      meta_template_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "Meta's own numeric template ID returned after creation",
      },
      name: {
        type: Sequelize.STRING(512),
        allowNull: false,
        comment: 'Template name — lowercase_underscores',
      },

      // ── Template definition ──────────────────────────────────────────────
      category: {
        type: Sequelize.ENUM('UTILITY', 'MARKETING', 'AUTHENTICATION'),
        allowNull: false,
      },
      language: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'en_US',
      },
      components: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Template components array (HEADER, BODY, FOOTER, BUTTONS)',
      },

      // ── Approval status (synced from Meta via webhook) ───────────────────
      status: {
        type: Sequelize.ENUM('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'),
        allowNull: false,
        defaultValue: 'PENDING',
        comment: 'Kept in sync by message_template_status_update webhook events',
      },
      rejection_reason: {
        type: Sequelize.STRING(512),
        allowNull: true,
        comment: 'Reason provided by Meta when status = REJECTED',
      },

      // ── Cache control ────────────────────────────────────────────────────
      last_synced_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Timestamp of the last successful fetch from Meta API',
      },

      // ── Timestamps ────────────────────────────────────────────────────────
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Unique constraint: one template name per tenant (business_id + name)
    await queryInterface.addIndex('whatsapp_templates', ['business_id', 'name'], {
      name: 'idx_whatsapp_templates_business_name',
      unique: true,
    });

    // Fast lookup by status for dashboard badge filters
    await queryInterface.addIndex('whatsapp_templates', ['business_id', 'status'], {
      name: 'idx_whatsapp_templates_business_status',
    });

    // Lookup by meta_template_id for webhook status updates
    await queryInterface.addIndex('whatsapp_templates', ['meta_template_id'], {
      name: 'idx_whatsapp_templates_meta_id',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('whatsapp_templates');
  },
};
