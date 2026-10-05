'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Subscription extends Model {
    static associate(models) {
      Subscription.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
      Subscription.belongsTo(models.Plan, { foreignKey: 'plan_id', as: 'plan' });
    }
  }
  Subscription.init({
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