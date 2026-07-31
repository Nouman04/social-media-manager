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
      SocialNumber.hasMany(models.BusinessSocial, { foreignKey: 'business_number', as: 'socials' });
    }
  };

  return SocialNumber;
};
