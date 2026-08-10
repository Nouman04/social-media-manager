'use strict';
module.exports = (sequelize, DataTypes) => {
  const SocialPlatformNumber = sequelize.define('SocialPlatformNumber', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    social_number_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'social_numbers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    social_platform_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'social_platforms', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Whether this number is verified on this platform',
    },
  }, {
    tableName: 'social_platform_numbers',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  SocialPlatformNumber.associate = function (models) {
    if (models.SocialNumber) {
      SocialPlatformNumber.belongsTo(models.SocialNumber, { foreignKey: 'social_number_id', as: 'socialNumber' });
    }
    if (models.SocialPlatform) {
      SocialPlatformNumber.belongsTo(models.SocialPlatform, { foreignKey: 'social_platform_id', as: 'socialPlatform' });
    }
  };

  return SocialPlatformNumber;
};
