'use strict';
module.exports = (sequelize, DataTypes) => {
  const Business = sequelize.define('Business', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'businesses',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Business.associate = function (models) {
    if (models.User) {
      Business.belongsTo(models.User, { foreignKey: 'created_by', as: 'owner' });
      Business.hasMany(models.User, { foreignKey: 'business_id', as: 'members' });
    }
    if (models.Role) {
      Business.hasMany(models.Role, { foreignKey: 'business_id', as: 'roles' });
    }
    if (models.Permission) {
      Business.hasMany(models.Permission, { foreignKey: 'business_id', as: 'permissions' });
    }
    if (models.SocialNumber) {
      Business.hasMany(models.SocialNumber, { foreignKey: 'business_id', as: 'socialNumbers' });
    }
    if (models.BusinessSocial) {
      Business.hasMany(models.BusinessSocial, { foreignKey: 'business_id', as: 'businessSocials' });
    }
    if (models.WhatsappDetail) {
      Business.hasMany(models.WhatsappDetail, { foreignKey: 'business_id', as: 'whatsappDetails' });
    }
    if (models.WhatsappMessage) {
      Business.hasMany(models.WhatsappMessage, { foreignKey: 'business_id', as: 'whatsappMessages' });
    }
    if (models.WhatsappTemplate) {
      Business.hasMany(models.WhatsappTemplate, { foreignKey: 'business_id', as: 'whatsappTemplates' });
    }
    if (models.Address) {
      // Polymorphic: addresses.addressable_id -> businesses.id where addressable_type = 'Business'
      Business.hasOne(models.Address, {
        foreignKey: 'addressable_id',
        constraints: false,
        scope: { addressable_type: 'Business' },
        as: 'address',
      });
    }
  };

  return Business;
};
