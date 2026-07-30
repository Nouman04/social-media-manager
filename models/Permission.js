'use strict';
module.exports = (sequelize, DataTypes) => {
  const Permission = sequelize.define('Permission', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'businesses',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  }, {
    tableName: 'permissions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Permission.associate = function(models) {
    if (models.Business) {
      Permission.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }

    if (models.Role) {
      Permission.belongsToMany(models.Role, {
        through: models.RolePermission || 'roles_has_permissions',
        foreignKey: 'permission_id',
        otherKey: 'role_id',
        as: 'roles',
      });
    }

    if (models.User) {
      Permission.belongsToMany(models.User, {
        through: models.UserPermission || 'model_has_permissions',
        foreignKey: 'permission_id',
        otherKey: 'user_id',
        as: 'users',
      });
    }

    if (models.RolePermission) {
      Permission.hasMany(models.RolePermission, { foreignKey: 'permission_id' });
    }
    if (models.UserPermission) {
      Permission.hasMany(models.UserPermission, { foreignKey: 'permission_id' });
    }
  };

  return Permission;
};
