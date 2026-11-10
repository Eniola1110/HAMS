
const express = require('express')
const router = express.Router()

const verifyToken = require('../middleware/authMiddleware')
const authorizeRoles = require('../middleware/roleMiddleware')

const { getStudentProfile } = require('../controllers/studentController')

router.get(
  '/profile',
  verifyToken,
  authorizeRoles('student'),
  getStudentProfile
)

module.exports = router
