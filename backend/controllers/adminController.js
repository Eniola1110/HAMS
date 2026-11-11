const db = require('../config/db')
const crypto = require('crypto')

// get admin profile

const getAdminProfile = async (req, res) => {
  try {
    const sql = `
      SELECT id, username, full_name, created_at
      FROM admins
      WHERE id = ?
    `
    const [results] = await db.query(sql, [req.user.id])

    if (results.length === 0) {
      return res.status(404).json({
        message: 'Admin not found'
      })
    }

    return res.status(200).json({
      message: 'Admin profile retrieved successfully',
      admin: results[0]
    })

  } catch (err) {
    return res.status(500).json({
      message: 'Unable to retrieve admin profile'
    })
  }
}

// get pending applications

const getPendingApplications = async (req, res) => {
  try {
    const sql = `
      SELECT
        a.id AS application_id,
        a.reference_code,
        a.status,
        a.requested_at,

        s.id AS student_id,
        s.matric_no,
        s.surname,
        s.first_name,
        s.middle_name,
        s.department,
        s.level,
        s.gender,

        h.id AS hostel_id,
        h.name AS preferred_hostel

      FROM allocations a

      JOIN students s
        ON a.student_id = s.id

      JOIN hostels h
        ON a.preferred_hostel_id = h.id

      WHERE a.status = 'Pending'

      ORDER BY a.requested_at DESC
    `

    const [applications] = await db.query(sql)

    return res.status(200).json({
      message: 'Pending applications retrieved successfully',
      total: applications.length,
      applications
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to retrieve pending applications'
    })
  }
}

// grant application

const grantApplication = async (req, res) => {
  let connection
  let transactionStarted = false

  try {
    const applicationId = Number(req.params.id)
    const roomId = Number(req.body.room_id)

    if (
      !Number.isInteger(applicationId) ||
      applicationId <= 0 ||
      !Number.isInteger(roomId) ||
      roomId <= 0
    ) {
      return res.status(400).json({
        message: 'Please provide valid application and room IDs'
      })
    }

    connection = await db.getConnection()

    await connection.beginTransaction()
    transactionStarted = true

    // 1. Find and lock the pending application
    const [applications] = await connection.query(
      `SELECT id, student_id, preferred_hostel_id, status
       FROM allocations
       WHERE id = ?
       FOR UPDATE`,
      [applicationId]
    )

    if (applications.length === 0) {
      await connection.rollback()
      transactionStarted = false

      return res.status(404).json({
        message: 'Application not found'
      })
    }

    const application = applications[0]

    if (application.status !== 'Pending') {
      await connection.rollback()
      transactionStarted = false

      return res.status(409).json({
        message: 'This application has already been reviewed'
      })
    }

    // 2. Find and lock the selected room
    const [rooms] = await connection.query(
      `SELECT id, hostel_id, room_number, capacity,
              currency_occupancy, status
       FROM rooms
       WHERE id = ?
       FOR UPDATE`,
      [roomId]
    )

    if (rooms.length === 0) {
      await connection.rollback()
      transactionStarted = false

      return res.status(404).json({
        message: 'Selected room not found'
      })
    }

    const room = rooms[0]

    // 3. Ensure the room belongs to the preferred hostel
    if (room.hostel_id !== application.preferred_hostel_id) {
      await connection.rollback()
      transactionStarted = false

      return res.status(400).json({
        message: 'Selected room does not belong to the preferred hostel'
      })
    }

    // 4. Check room availability
    if (
      room.status === 'Maintenance' ||
      Number(room.currency_occupancy) >= Number(room.capacity)
    ) {
      await connection.rollback()
      transactionStarted = false

      return res.status(409).json({
        message: 'Selected room has no available space'
      })
    }

    // 5. Assign the room and grant the application
    const newOccupancy = Number(room.currency_occupancy) + 1

    const newRoomStatus =
      newOccupancy >= Number(room.capacity) ? 'Full' : 'Available'

    await connection.query(
      `UPDATE rooms
       SET currency_occupancy = ?, status = ?
       WHERE id = ?`,
      [newOccupancy, newRoomStatus, roomId]
    )

    await connection.query(
      `UPDATE allocations
       SET room_id = ?,
           status = 'Granted',
           actioned_at = CURRENT_TIMESTAMP,
           action_reason = NULL
       WHERE id = ?`,
      [roomId, applicationId]
    )

    await connection.commit()
    transactionStarted = false

    return res.status(200).json({
      message: 'Hostel application granted successfully',
      allocation: {
        application_id: applicationId,
        student_id: application.student_id,
        room_id: roomId,
        room_number: room.room_number,
        status: 'Granted'
      }
    })

  } catch (err) {
    if (transactionStarted && connection) {
      await connection.rollback()
    }

    console.error(err)

    return res.status(500).json({
      message: 'Unable to grant hostel application'
    })

  } finally {
    if (connection) {
      connection.release()
    }
  }
}

// reject application

const rejectApplication = async (req, res) => {
  let connection
  let transactionStarted = false

  try {
    const applicationId = Number(req.params.id)
    const reason = req.body?.reason?.trim()

    // Validate application ID
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({
        message: 'Please provide a valid application ID'
      })
    }

    // Validate rejection reason
    if (!reason) {
      return res.status(400).json({
        message: 'A rejection reason is required'
      })
    }

    if (reason.length > 255) {
      return res.status(400).json({
        message: 'Rejection reason cannot exceed 255 characters'
      })
    }

    connection = await db.getConnection()

    await connection.beginTransaction()
    transactionStarted = true

    // Find and lock the application
    const [applications] = await connection.query(
      `SELECT id, status
       FROM allocations
       WHERE id = ?
       FOR UPDATE`,
      [applicationId]
    )

    if (applications.length === 0) {
      await connection.rollback()
      transactionStarted = false

      return res.status(404).json({
        message: 'Application not found'
      })
    }

    // Ensure the application is still pending
    if (applications[0].status !== 'Pending') {
      await connection.rollback()
      transactionStarted = false

      return res.status(409).json({
        message: 'This application has already been reviewed'
      })
    }

    // Reject the application
    await connection.query(
      `UPDATE allocations
       SET status = 'Rejected',
           action_reason = ?,
           actioned_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason, applicationId]
    )

    await connection.commit()
    transactionStarted = false

    return res.status(200).json({
      message: 'Hostel application rejected successfully',
      application: {
        application_id: applicationId,
        status: 'Rejected',
        reason
      }
    })

  } catch (err) {
    if (transactionStarted && connection) {
      await connection.rollback()
    }

    console.error(err)

    return res.status(500).json({
      message: 'Unable to reject hostel application'
    })

  } finally {
    if (connection) {
      connection.release()
    }
  }
}



module.exports = { getAdminProfile, getPendingApplications,grantApplication, rejectApplication}