'use strict';
module.exports = (sequelize, DataTypes) => {
  const RolePermission = sequelize.define('RolePermission', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    role_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'roles',
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
    tableName: 'roles_has_permissions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  RolePermission.associate = function(models) {
    if (models.Role) {
      RolePermission.belongsTo(models.Role, { foreignKey: 'role_id' });
    }
    if (models.Permission) {
      RolePermission.belongsTo(models.Permission, { foreignKey: 'permission_id' });
    }
  };

  return RolePermission;
};
