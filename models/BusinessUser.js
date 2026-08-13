'use strict';
module.exports = (sequelize, DataTypes) => {
  const BusinessUser = sequelize.define('BusinessUser', {
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
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    is_owner: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'True for the user who created the business',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Set to 0 to remove the user from the business (membership is kept for history)',
    },
    invited_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Which user sent the invitation',
    },
  }, {
    tableName: 'business_users',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  BusinessUser.associate = function (models) {
    if (models.Business) {
      BusinessUser.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
    if (models.User) {
      BusinessUser.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
      BusinessUser.belongsTo(models.User, { foreignKey: 'invited_by', as: 'inviter' });
    }
  };

  return BusinessUser;
};
