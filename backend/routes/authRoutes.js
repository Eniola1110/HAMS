const express = require('express')
const router = express.Router()

const { verify_matric_no, register, login, adminLogin } = require('../controllers/authController')

router.post('/verify-matric', verify_matric_no)
router.post('/register', register)
router.post('/login', login)
router.post('/admin-login', adminLogin)

module.exports = router
