'use strict';
module.exports = (sequelize, DataTypes) => {
  const BusinessProfile = sequelize.define('BusinessProfile', {
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
    NTN: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    logo: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    country_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'countries',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  }, {
    tableName: 'business_profiles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  BusinessProfile.associate = function(models) {
    if (models.Business) {
      BusinessProfile.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
    if (models.Country) {
      BusinessProfile.belongsTo(models.Country, { foreignKey: 'country_id', as: 'country' });
    }
  };

  return BusinessProfile;
};