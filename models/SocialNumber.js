'use strict';
module.exports = (sequelize, DataTypes) => {
  const SocialNumber = sequelize.define('SocialNumber', {
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
    phone_number: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true, // Remove this if duplicate numbers are allowed
    },
    is_activated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    tableName: 'social_numbers',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  SocialNumber.associate = function(models) {
    if (models.Business) {
      SocialNumber.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
    if (models.BusinessSocial) {
      SocialNumber.belongsToMany(models.BusinessSocial, {
        through: models.BusinessSocialNumber || 'business_social_numbers',
        foreignKey: 'social_number_id',
        otherKey: 'business_social_id',
        as: 'businessSocials',
      });
    }
    if (models.BusinessSocialNumber) {
      SocialNumber.hasOne(models.BusinessSocialNumber, { foreignKey: 'social_number_id', as: 'businessSocialLink' });
    }
  };

  return SocialNumber;
};
