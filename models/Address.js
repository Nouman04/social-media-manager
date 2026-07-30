'use strict';
module.exports = (sequelize, DataTypes) => {
  const Address = sequelize.define('Address', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    addressable_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    addressable_type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'addresses',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Address.associate = function(models) {
  };

  return Address;
};
