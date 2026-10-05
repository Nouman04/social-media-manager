'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Plan extends Model {
    static associate(models) {
      Plan.hasMany(models.PlanFeature, { foreignKey: 'plan_id', as: 'features' });
      Plan.hasMany(models.Subscription, { foreignKey: 'plan_id', as: 'subscriptions' });
    }
  }
  Plan.init({
    uuid: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    description: DataTypes.TEXT,
    stripe_product_id: {
      type: DataTypes.STRING(255),
      unique: true
    },
    stripe_price_id: {
      type: DataTypes.STRING(255),
      unique: true
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'usd'
    },
    interval: {
      type: DataTypes.ENUM('month', 'year'),
      allowNull: false,
      defaultValue: 'month'
    },
    trial_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    }
  }, {
    sequelize,
    modelName: 'Plan',
    tableName: 'plans',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });
  return Plan;
};
