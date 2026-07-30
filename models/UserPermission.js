'use strict';
module.exports = (sequelize, DataTypes) => {
  const UserPermission = sequelize.define('UserPermission', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    permission_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'permissions',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  }, {
    tableName: 'model_has_permissions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  UserPermission.associate = function(models) {
    if (models.User) {
      UserPermission.belongsTo(models.User, { foreignKey: 'user_id' });
    }
    if (models.Permission) {
      UserPermission.belongsTo(models.Permission, { foreignKey: 'permission_id' });
    }
  };

  return UserPermission;
};
