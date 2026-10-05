'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PlanFeature extends Model {
    static associate(models) {
      PlanFeature.belongsTo(models.Plan, { foreignKey: 'plan_id', as: 'plan' });
    }
  }
  PlanFeature.init({
    uuid: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true
    },
    plan_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    feature_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    feature_value: {
      type: DataTypes.STRING(255),
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'PlanFeature',
    tableName: 'plan_features',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });
  return PlanFeature;
};
