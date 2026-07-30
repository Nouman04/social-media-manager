'use strict';
module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define('Role', {
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
    tableName: 'roles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Role.associate = function(models) {
    if (models.Business) {
      Role.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }

    if (models.User) {
      Role.belongsToMany(models.User, {
        through: models.UserRole || 'model_has_roles',
        foreignKey: 'role_id',
        otherKey: 'user_id',
        as: 'users',
      });
    }

    if (models.Permission) {
      Role.belongsToMany(models.Permission, {
        through: models.RolePermission || 'roles_has_permissions',
        foreignKey: 'role_id',
        otherKey: 'permission_id',
        as: 'permissions',
      });
    }

    if (models.RolePermission) {
      Role.hasMany(models.RolePermission, { foreignKey: 'role_id' });
    }
    if (models.UserRole) {
      Role.hasMany(models.UserRole, { foreignKey: 'role_id' });
    }
  };

  return Role;
};
