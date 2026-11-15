'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Subscription extends Model {
    static associate(models) {
      Subscription.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
      Subscription.belongsTo(models.Plan, { foreignKey: 'plan_id', as: 'plan' });
      // One row per business; every plan request of the business points at it.
      Subscription.hasMany(models.SubscriptionRequest, { foreignKey: 'subscription_id', as: 'requests' });
      Subscription.hasMany(models.SubscriptionHistory, { foreignKey: 'subscription_id', as: 'history' });
    }
  }
  Subscription.init({
    // Public id used in URLs (GET / PUT /subscriptions/:uuid).
    uuid: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true,
    },
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    plan_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    stripe_subscription_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    // Lifecycle for manual billing (see migrations/20261115000000-add-status-to-subscriptions.js).
    status: {
      type: DataTypes.ENUM('pending', 'active', 'cancelled', 'expired', 'rejected'),
      allowNull: false,
      defaultValue: 'pending',
    },
    // Stripe-era column, kept but no longer written; use `status`.
    stripe_status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'incomplete'
    },
    trial_ends_at: DataTypes.DATE,
    current_period_start: DataTypes.DATE,
    current_period_end: DataTypes.DATE,
    ends_at: DataTypes.DATE,
    canceled_at: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'Subscription',
    tableName: 'subscriptions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });
  return Subscription;
};