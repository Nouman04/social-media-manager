'use strict';
const { Model } = require('sequelize');

/** Append-only log of every subscription change. Never updated. */
module.exports = (sequelize, DataTypes) => {
  class SubscriptionHistory extends Model {
    static associate(models) {
      SubscriptionHistory.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
      SubscriptionHistory.belongsTo(models.Subscription, { foreignKey: 'subscription_id', as: 'subscription' });
      SubscriptionHistory.belongsTo(models.SubscriptionRequest, { foreignKey: 'subscription_request_id', as: 'request' });
      SubscriptionHistory.belongsTo(models.Plan, { foreignKey: 'plan_id', as: 'plan' });
      SubscriptionHistory.belongsTo(models.Plan, { foreignKey: 'previous_plan_id', as: 'previous_plan' });
      SubscriptionHistory.belongsTo(models.User, { foreignKey: 'actor_id', as: 'actor' });
    }
  }
  SubscriptionHistory.init({
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    business_id: { type: DataTypes.INTEGER, allowNull: false },
    subscription_id: DataTypes.BIGINT.UNSIGNED,
    subscription_request_id: DataTypes.BIGINT.UNSIGNED,
    action: { type: DataTypes.STRING(40), allowNull: false },
    from_status: DataTypes.STRING(20),
    to_status: DataTypes.STRING(20),
    plan_id: DataTypes.BIGINT.UNSIGNED,
    previous_plan_id: DataTypes.BIGINT.UNSIGNED,
    actor_id: DataTypes.INTEGER,
    details: DataTypes.JSON,
  }, {
    sequelize,
    modelName: 'SubscriptionHistory',
    tableName: 'subscription_histories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });
  return SubscriptionHistory;
};
