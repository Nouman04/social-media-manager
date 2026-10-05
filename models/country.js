'use strict';
module.exports = (sequelize, DataTypes) => {
  const Country = sequelize.define('Country', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  }, {
    tableName: 'countries',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Country.associate = function(models) {
    if (models.BusinessProfile) {
      Country.hasMany(models.BusinessProfile, { foreignKey: 'country_id', as: 'businessProfiles' });
    }
  };

  return Country;
};