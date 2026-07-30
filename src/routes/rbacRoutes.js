const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbacController');
const passport = require('passport');

router.use((req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    req.user = user;
    next();
  })(req, res, next);
});

// Role CRUD
router.post('/roles', rbacController.createRole);
router.get('/roles', rbacController.getRoles);
router.get('/roles/:id', rbacController.getRoleById);
router.put('/roles/:id', rbacController.updateRole);
router.delete('/roles/:id', rbacController.deleteRole);

// Permission CRUD
router.post('/permissions', rbacController.createPermission);
router.get('/permissions', rbacController.getPermissions);
router.get('/permissions/:id', rbacController.getPermissionById);
router.put('/permissions/:id', rbacController.updatePermission);
router.delete('/permissions/:id', rbacController.deletePermission);

// Role-Permission Associations
router.post('/roles/:roleId/permissions', rbacController.givePermissionsToRole);
router.delete('/roles/:roleId/permissions', rbacController.revokePermissionsFromRole);

// User Direct Permissions
router.post('/users/:userId/permissions', rbacController.givePermissionsToUser);
router.delete('/users/:userId/permissions', rbacController.revokePermissionsFromUser);

// User Roles Assignment
router.post('/users/:userId/roles', rbacController.assignRolesToUser);
router.delete('/users/:userId/roles', rbacController.removeRolesFromUser);

// Get User Roles & Permissions
router.get('/users/:userId/roles-permissions', rbacController.getUserRolesAndPermissions);

module.exports = router;
