'use strict';
module.exports = (sequelize, DataTypes) => {
  const BusinessSocial = sequelize.define('BusinessSocial', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'businesses',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    type: {
      type: DataTypes.ENUM('tiktok', 'instagram', 'whatsapp', 'facebook'),
      allowNull: false,
    },
    business_number: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'social_numbers',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    is_activated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    tableName: 'business_socials',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  BusinessSocial.associate = function(models) {
    if (models.Business) {
      BusinessSocial.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
    if (models.SocialNumber) {
      BusinessSocial.belongsTo(models.SocialNumber, { foreignKey: 'business_number', as: 'socialNumber' });
    }
  };

  return BusinessSocial;
};
