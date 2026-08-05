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
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      unique: true, // the business's own number for this social account
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
      BusinessSocial.belongsToMany(models.SocialNumber, {
        through: models.BusinessSocialNumber || 'business_social_numbers',
        foreignKey: 'business_social_id',
        otherKey: 'social_number_id',
        as: 'socialNumbers',
      });
    }
    if (models.BusinessSocialNumber) {
      BusinessSocial.hasMany(models.BusinessSocialNumber, { foreignKey: 'business_social_id', as: 'socialNumberLinks' });
    }
  };

  return BusinessSocial;
};
