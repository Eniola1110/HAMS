const express = require('express')
const router = express.Router()

const verifyToken = require('../middleware/authMiddleware')
const authorizeRoles = require('../middleware/roleMiddleware')

const { getAdminProfile, getPendingApplications, grantApplication, rejectApplication } = require('../controllers/adminController')

router.get('/profile', verifyToken, authorizeRoles('admin'), getAdminProfile)
router.get('/applications/pending', verifyToken, authorizeRoles('admin'), getPendingApplications)
router.patch('/applications/:id/grant', verifyToken, authorizeRoles('admin'), grantApplication)
router.patch('/applications/:id/reject', verifyToken, authorizeRoles('admin'), rejectApplication)

module.exports = router
