'use strict';
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4,
      comment: 'Public identifier — used in invitation links instead of the numeric id',
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
    authentication_token: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: 'Single-use invitation token; paired with uuid in the invite link',
    },
    invitation_expired_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When the invitation token stops working; a new link can then be requested',
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
      User.hasMany(models.Business, { foreignKey: 'created_by', as: 'ownedBusinesses' });
      User.belongsToMany(models.Business, {
        through: models.BusinessUser || 'business_users',
        foreignKey: 'user_id',
        otherKey: 'business_id',
        as: 'businesses',
      });
    }

    if (models.BusinessUser) {
      User.hasMany(models.BusinessUser, { foreignKey: 'user_id', as: 'businessLinks' });
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

    if (models.Conversation) {
      User.hasMany(models.Conversation, { foreignKey: 'created_by', as: 'createdConversations' });
      User.belongsToMany(models.Conversation, {
        through: models.ConversationParticipant || 'conversation_participants',
        foreignKey: 'user_id',
        otherKey: 'conversation_id',
        as: 'conversations'
      });
    }
  };

  return User;
};
