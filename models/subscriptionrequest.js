'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class SubscriptionRequest extends Model {
    static associate(models) {
      SubscriptionRequest.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
      SubscriptionRequest.belongsTo(models.Plan, { foreignKey: 'plan_id', as: 'plan' });
      SubscriptionRequest.belongsTo(models.User, { foreignKey: 'requested_by', as: 'requester' });
      SubscriptionRequest.belongsTo(models.User, { foreignKey: 'reviewed_by', as: 'reviewer' });
      SubscriptionRequest.belongsTo(models.Subscription, { foreignKey: 'subscription_id', as: 'subscription' });
    }
  }
  SubscriptionRequest.init({
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    business_id: { type: DataTypes.INTEGER, allowNull: false },
    requested_by: DataTypes.INTEGER,
    plan_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    type: { type: DataTypes.ENUM('new', 'change'), allowNull: false, defaultValue: 'new' },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending',
    },
    note: DataTypes.TEXT,
    payment_reference: DataTypes.STRING(255),
    receipt_url: DataTypes.STRING(512),
    admin_note: DataTypes.TEXT,
    reject_reason: DataTypes.TEXT,
    reviewed_by: DataTypes.INTEGER,
    reviewed_at: DataTypes.DATE,
    subscription_id: DataTypes.BIGINT.UNSIGNED,
  }, {
    sequelize,
    modelName: 'SubscriptionRequest',
    tableName: 'subscription_requests',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });
  return SubscriptionRequest;
};
