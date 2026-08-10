'use strict';
module.exports = (sequelize, DataTypes) => {
  const SocialPlatform = sequelize.define('SocialPlatform', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      comment: 'Machine name of the platform (e.g. whatsapp, instagram)',
    },
    label: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Human-readable name shown in the UI',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'social_platforms',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  SocialPlatform.associate = function (models) {
    if (models.SocialNumber) {
      SocialPlatform.belongsToMany(models.SocialNumber, {
        through: models.SocialPlatformNumber || 'social_platform_numbers',
        foreignKey: 'social_platform_id',
        otherKey: 'social_number_id',
        as: 'socialNumbers',
      });
    }
    if (models.SocialPlatformNumber) {
      SocialPlatform.hasMany(models.SocialPlatformNumber, { foreignKey: 'social_platform_id', as: 'numberLinks' });
    }
    if (models.Conversation) {
      SocialPlatform.hasMany(models.Conversation, { foreignKey: 'social_platform_id', as: 'conversations' });
    }
  };

  return SocialPlatform;
};
