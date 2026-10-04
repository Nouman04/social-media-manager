'use strict';

module.exports = (sequelize, DataTypes) => {
  const AgentSetting = sequelize.define('AgentSetting', {
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
      unique: true,
      references: {
        model: 'businesses',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },

    // ── OpenRouter credentials ──────────────────────────────────────────────
    openrouter_api_key: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'User-supplied OpenRouter API key (stored server-side only)',
    },

    // ── Model selection ─────────────────────────────────────────────────────
    model: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: 'deepseek/deepseek-chat',
      comment: 'Full OpenRouter model ID',
    },

    // ── System prompt ───────────────────────────────────────────────────────
    system_prompt: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Custom system/persona prompt prepended to every chat session',
    },
  }, {
    tableName: 'agent_settings',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  AgentSetting.associate = function (models) {
    if (models.Business) {
      AgentSetting.belongsTo(models.Business, {
        foreignKey: 'business_id',
        as: 'business',
      });
    }
  };

  return AgentSetting;
};
