'use strict';
module.exports = (sequelize, DataTypes) => {
  const Profile = sequelize.define('Profile', {
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
    dob: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
  }, {
    tableName: 'profiles',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  Profile.associate = function(models) {
    if (models.User) {
      Profile.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  };

  return Profile;
};
