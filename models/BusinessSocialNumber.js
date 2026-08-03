'use strict';
module.exports = (sequelize, DataTypes) => {
  const BusinessSocialNumber = sequelize.define('BusinessSocialNumber', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    business_social_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'business_socials',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    social_number_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true, // a social number syncs to at most one business social
      references: {
        model: 'social_numbers',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  }, {
    tableName: 'business_social_numbers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  BusinessSocialNumber.associate = function (models) {
    if (models.BusinessSocial) {
      BusinessSocialNumber.belongsTo(models.BusinessSocial, { foreignKey: 'business_social_id', as: 'businessSocial' });
    }
    if (models.SocialNumber) {
      BusinessSocialNumber.belongsTo(models.SocialNumber, { foreignKey: 'social_number_id', as: 'socialNumber' });
    }
  };

  return BusinessSocialNumber;
};
