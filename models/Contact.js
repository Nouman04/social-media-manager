'use strict';

module.exports = (sequelize, DataTypes) => {
  const Contact = sequelize.define('Contact', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'businesses', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    name: { type: DataTypes.STRING(255), allowNull: true },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: 'Digits only with country code, e.g. 923001234567 — the WhatsApp "to"',
    },
    whatsapp_status: {
      type: DataTypes.ENUM('unknown', 'valid', 'invalid'),
      allowNull: false,
      defaultValue: 'unknown',
      comment: 'Learned from message results — valid = reached on WhatsApp, invalid = Meta error 131026',
    },
    whatsapp_checked_at: { type: DataTypes.DATE, allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: true },
    tags: { type: DataTypes.JSON, allowNull: true },
    whatsapp_consent: {
      type: DataTypes.ENUM('opted_in', 'opted_out', 'unknown'),
      allowNull: false,
      defaultValue: 'unknown',
    },
    consent_source: { type: DataTypes.STRING(50), allowNull: true },
    consent_at: { type: DataTypes.DATE, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    tableName: 'contacts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Contact.associate = function (models) {
    if (models.Business) {
      Contact.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
  };

  return Contact;
};
