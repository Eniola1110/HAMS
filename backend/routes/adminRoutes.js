const express = require('express')
const router = express.Router()

const verifyToken = require('../middleware/authMiddleware')
const authorizeRoles = require('../middleware/roleMiddleware')

const { getAdminProfile, getPendingApplications, grantApplication, rejectApplication, getAllHostels, addHostel, updateHostel, deleteHostel, addRoom, getHostelRooms, updateRoom, deleteRoom, getAllRooms, getDashboardStats } = require('../controllers/adminController')

router.get('/profile', verifyToken, authorizeRoles('admin'), getAdminProfile)
router.get('/applications/pending', verifyToken, authorizeRoles('admin'), getPendingApplications)
router.patch('/applications/:id/grant', verifyToken, authorizeRoles('admin'), grantApplication)
router.patch('/applications/:id/reject', verifyToken, authorizeRoles('admin'), rejectApplication)
router.get('/hostels', verifyToken, authorizeRoles('admin'), getAllHostels)
router.post('/hostels', verifyToken, authorizeRoles('admin'), addHostel)
router.put('/hostels/:id', verifyToken, authorizeRoles('admin'), updateHostel)
router.delete('/hostels/:id', verifyToken, authorizeRoles('admin'), deleteHostel)
router.post('/hostels/:hostelId/rooms', verifyToken, authorizeRoles('admin'), addRoom)
router.get('/hostels/:hostelId/rooms', verifyToken, authorizeRoles('admin'), getHostelRooms)
router.put('/rooms/:id', verifyToken, authorizeRoles('admin'), updateRoom)
router.delete('/rooms/:id', verifyToken, authorizeRoles('admin'),deleteRoom)
router.get('/rooms', verifyToken, authorizeRoles('admin'), getAllRooms)
router.get('/dashboard-stats', verifyToken, authorizeRoles('admin'), getDashboardStats)
module.exports = router
