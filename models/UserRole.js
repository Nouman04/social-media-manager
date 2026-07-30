'use strict';
module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define('UserRole', {
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
  }, {
    tableName: 'model_has_roles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  UserRole.associate = function(models) {
    if (models.User) {
      UserRole.belongsTo(models.User, { foreignKey: 'user_id' });
    }
    if (models.Role) {
      UserRole.belongsTo(models.Role, { foreignKey: 'role_id' });
    }
  };

  return UserRole;
};
