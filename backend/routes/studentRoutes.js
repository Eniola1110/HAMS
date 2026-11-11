
const express = require('express')
const router = express.Router()

const verifyToken = require('../middleware/authMiddleware')
const authorizeRoles = require('../middleware/roleMiddleware')

const { getStudentProfile, getAvailableHostels, submitHostelApplication } = require('../controllers/studentController')

router.get('/profile', verifyToken, authorizeRoles('student'), getStudentProfile)
router.get('/hostels', verifyToken, authorizeRoles('student'), getAvailableHostels)
router.post('/applications', verifyToken, authorizeRoles('student'), submitHostelApplication)
module.exports = router
