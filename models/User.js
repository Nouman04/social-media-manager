'use strict';
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'businesses',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true, 
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true, 
    },
    password: {
      type: DataTypes.TEXT('long'),
      allowNull: true, 
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'inactive',
      allowNull: false,
    },
    email_verified_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    authentication_code: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    code_expired_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'users',
    timestamps: true, 
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  User.associate = function(models) {
    if (models.Business) {
      User.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
      User.hasMany(models.Business, { foreignKey: 'user_id', as: 'ownedBusinesses' });
    }

    if (models.Profile) {
      User.hasOne(models.Profile, { foreignKey: 'user_id', as: 'profile' });
    }

    if (models.Role) {
      User.belongsToMany(models.Role, {
        through: models.UserRole || 'model_has_roles',
        foreignKey: 'user_id',
        otherKey: 'role_id',
        as: 'roles'
      });
    }

    if (models.Permission) {
      User.belongsToMany(models.Permission, {
        through: models.UserPermission || 'model_has_permissions',
        foreignKey: 'user_id',
        otherKey: 'permission_id',
        as: 'permissions'
      });
    }
  };

  return User;
};
