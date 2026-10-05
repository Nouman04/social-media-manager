'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ActivityLog extends Model {
    static associate(models) {
      // define association here
    }
  }
  ActivityLog.init({
    log_name: DataTypes.STRING(100),
    description: DataTypes.STRING(255),
    subject_type: DataTypes.STRING(100),
    subject_id: DataTypes.STRING(255),
    causer_type: DataTypes.STRING(100),
    causer_id: DataTypes.STRING(255),
    properties: DataTypes.JSON,
    ip_address: DataTypes.STRING(45),
    user_agent: DataTypes.TEXT,
  }, {
    sequelize,
    modelName: 'ActivityLog',
    tableName: 'activity_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });
  return ActivityLog;
};