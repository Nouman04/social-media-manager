'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config.js')[env];
const db = {};

let sequelize;
if (config.use_env_variable && process.env[config.use_env_variable]) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// --- Global Audit Logging Hooks ---
const IGNORED_TABLES = ['chats', 'chat_messages', 'attachments', 'activity_logs'];
const IGNORED_MODELS = ['Chat', 'ChatMessage', 'Attachment', 'ActivityLog'];

function shouldIgnore(instance) {
  if (!instance || !instance.constructor) return true;
  const modelName = instance.constructor.name;
  const tableName = instance.constructor.tableName;
  if (IGNORED_MODELS.includes(modelName)) return true;
  if (tableName && IGNORED_TABLES.includes(tableName)) return true;
  return false;
}

sequelize.addHook('afterCreate', async (instance, options) => {
  if (shouldIgnore(instance)) return;
  const modelName = instance.constructor.name;
  const ActivityLoggerService = require('../src/services/ActivityLoggerService');
  await ActivityLoggerService.log({
    logName: instance.constructor.tableName || modelName.toLowerCase() + 's',
    description: `Created ${modelName}`,
    subjectType: modelName,
    subjectId: instance.id || null,
    properties: {
      attributes: instance.toJSON()
    }
  });
});

sequelize.addHook('afterUpdate', async (instance, options) => {
  if (shouldIgnore(instance)) return;
  const changed = instance.changed();
  if (!changed || changed.length === 0) return;

  const oldData = {};
  const newData = {};
  for (const field of changed) {
    oldData[field] = instance.previous(field);
    newData[field] = instance.get(field);
  }

  const modelName = instance.constructor.name;
  const ActivityLoggerService = require('../src/services/ActivityLoggerService');
  await ActivityLoggerService.log({
    logName: instance.constructor.tableName || modelName.toLowerCase() + 's',
    description: `Updated ${modelName}`,
    subjectType: modelName,
    subjectId: instance.id || null,
    properties: {
      old: oldData,
      attributes: newData
    }
  });
});

sequelize.addHook('afterDestroy', async (instance, options) => {
  if (shouldIgnore(instance)) return;
  const modelName = instance.constructor.name;
  const ActivityLoggerService = require('../src/services/ActivityLoggerService');
  await ActivityLoggerService.log({
    logName: instance.constructor.tableName || modelName.toLowerCase() + 's',
    description: `Deleted ${modelName}`,
    subjectType: modelName,
    subjectId: instance.id || null,
    properties: {
      old: instance.toJSON()
    }
  });
});

module.exports = db;
