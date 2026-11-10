
const express = require('express')
const router = express.Router()

const verifyToken = require('../middleware/authMiddleware')
const authorizeRoles = require('../middleware/roleMiddleware')

const { getAdminProfile } = require('../controllers/adminController')

router.get(
  '/profile',
  verifyToken,
  authorizeRoles('admin'),
  getAdminProfile
)

module.exports = router
