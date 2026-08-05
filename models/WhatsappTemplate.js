'use strict';

module.exports = (sequelize, DataTypes) => {
  const WhatsappTemplate = sequelize.define('WhatsappTemplate', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },

    // ── Tenant linkage ──────────────────────────────────────────────────────
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'businesses', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },

    // ── Meta identifiers ────────────────────────────────────────────────────
    meta_template_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING(512),
      allowNull: false,
    },

    // ── Template definition ─────────────────────────────────────────────────
    category: {
      type: DataTypes.ENUM('UTILITY', 'MARKETING', 'AUTHENTICATION'),
      allowNull: false,
    },
    language: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'en_US',
    },
    components: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    // ── Approval status ─────────────────────────────────────────────────────
    status: {
      type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    rejection_reason: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },

    // ── Cache control ────────────────────────────────────────────────────────
    last_synced_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'whatsapp_templates',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  // ── Status → UI badge colour mapping (used by the dashboard) ───────────────
  WhatsappTemplate.STATUS_BADGE = {
    APPROVED:     'green',
    PENDING:      'yellow',
    REJECTED:     'red',
    PAUSED:       'orange',
    DISABLED:     'grey',
  };

  WhatsappTemplate.associate = function (models) {
    if (models.Business) {
      WhatsappTemplate.belongsTo(models.Business, {
        foreignKey: 'business_id',
        as: 'business',
      });
    }
  };

  return WhatsappTemplate;
};
