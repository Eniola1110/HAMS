const db = require('../config/db')

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

// Get all hostels

const getAllHostels = async (req, res) => {
  try {
    const sql = `
      SELECT
        h.id,
        h.name,
        h.gender_type,
        h.total_capacity,

        COUNT(r.id) AS room_count,

        COALESCE(SUM(r.capacity), 0)
          AS registered_room_capacity,

        COALESCE(SUM(r.currency_occupancy), 0)
          AS occupied_spaces,

        COALESCE(
          SUM(
            CASE
              WHEN r.status != 'Maintenance'
              THEN GREATEST(
                r.capacity - r.currency_occupancy, 0
              )
              ELSE 0
            END
          ), 0
        ) AS available_spaces

      FROM hostels h

      LEFT JOIN rooms r
        ON h.id = r.hostel_id

      GROUP BY
        h.id,
        h.name,
        h.gender_type,
        h.total_capacity

      ORDER BY h.id DESC
    `

    const [hostels] = await db.query(sql)

    return res.status(200).json({
      message: 'Hostels retrieved successfully',
      total: hostels.length,
      hostels
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to retrieve hostels'
    })
  }
}

// Add hostel

const addHostel = async (req, res) => {
  try {
    const { name, gender_type, total_capacity } = req.body

    // Validate hostel name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        message: 'Hostel name is required'
      })
    }

    // Validate gender category
    if (!['Male', 'Female'].includes(gender_type)) {
      return res.status(400).json({
        message: 'Gender type must be Male or Female'
      })
    }

    // Validate total capacity
    const capacity = Number(total_capacity)

    if (!Number.isInteger(capacity) || capacity <= 0) {
      return res.status(400).json({
        message: 'Total capacity must be a positive integer'
      })
    }

    const hostelName = name.trim()

    // Check for duplicate hostel name
    const [existingHostels] = await db.query(
      `SELECT id
       FROM hostels
       WHERE LOWER(name) = LOWER(?)
       LIMIT 1`,
      [hostelName]
    )

    if (existingHostels.length > 0) {
      return res.status(409).json({
        message: 'A hostel with this name already exists'
      })
    }

    // Insert new hostel
    const [result] = await db.query(
      `INSERT INTO hostels
       (name, gender_type, total_capacity)
       VALUES (?, ?, ?)`,
      [hostelName, gender_type, capacity]
    )

    return res.status(201).json({
      message: 'Hostel created successfully',
      hostel: {
        id: result.insertId,
        name: hostelName,
        gender_type,
        total_capacity: capacity
      }
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to create hostel'
    })
  }
}

// Update Hostel

const updateHostel = async (req, res) => {
  try {
    const { id } = req.params
    const { name, gender_type, total_capacity } = req.body

    // Validate hostel ID
    const hostelId = Number(id)

    if (!Number.isInteger(hostelId) || hostelId <= 0) {
      return res.status(400).json({
        message: 'Invalid hostel ID'
      })
    }

    // Validate hostel name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        message: 'Hostel name is required'
      })
    }

    // Validate gender category
    if (!['Male', 'Female'].includes(gender_type)) {
      return res.status(400).json({
        message: 'Gender type must be Male or Female'
      })
    }

    // Validate total capacity
    const capacity = Number(total_capacity)

    if (!Number.isInteger(capacity) || capacity <= 0) {
      return res.status(400).json({
        message: 'Total capacity must be a positive integer'
      })
    }

    const hostelName = name.trim()

    // Check whether hostel exists
    const [hostels] = await db.query(
      'SELECT id FROM hostels WHERE id = ?',
      [hostelId]
    )

    if (hostels.length === 0) {
      return res.status(404).json({
        message: 'Hostel not found'
      })
    }

    // Check for duplicate name, excluding this hostel
    const [existingHostels] = await db.query(
      `SELECT id FROM hostels
       WHERE LOWER(name) = LOWER(?)
       AND id != ?
       LIMIT 1`,
      [hostelName, hostelId]
    )

    if (existingHostels.length > 0) {
      return res.status(409).json({
        message: 'A hostel with this name already exists'
      })
    }

    // Update hostel
    await db.query(
      `UPDATE hostels
       SET name = ?, gender_type = ?, total_capacity = ?
       WHERE id = ?`,
      [hostelName, gender_type, capacity, hostelId]
    )

    return res.status(200).json({
      message: 'Hostel updated successfully',
      hostel: {
        id: hostelId,
        name: hostelName,
        gender_type,
        total_capacity: capacity
      }
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to update hostel'
    })
  }
}

// Delete Hostel

const deleteHostel = async (req, res) => {
  try {
    const { id } = req.params
    const hostelId = Number(id)

    // Validate hostel ID
    if (!Number.isInteger(hostelId) || hostelId <= 0) {
      return res.status(400).json({
        message: 'Invalid hostel ID'
      })
    }

    // Check whether hostel exists
    const [hostels] = await db.query(
      'SELECT id FROM hostels WHERE id = ?',
      [hostelId]
    )

    if (hostels.length === 0) {
      return res.status(404).json({
        message: 'Hostel not found'
      })
    }

    // Check whether the hostel has rooms
    const [rooms] = await db.query(
      'SELECT id FROM rooms WHERE hostel_id = ? LIMIT 1',
      [hostelId]
    )

    if (rooms.length > 0) {
      return res.status(409).json({
        message: 'Cannot delete hostel because it still has rooms'
      })
    }

    // Check whether the hostel has application records
    const [applications] = await db.query(
      'SELECT id FROM allocations WHERE preferred_hostel_id = ? LIMIT 1',
      [hostelId]
    )

    if (applications.length > 0) {
      return res.status(409).json({
        message: 'Cannot delete hostel because it has application records'
      })
    }

    // Delete hostel
    await db.query(
      'DELETE FROM hostels WHERE id = ?',
      [hostelId]
    )

    return res.status(200).json({
      message: 'Hostel deleted successfully'
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to delete hostel'
    })
  }
}

// Add room
const addRoom = async (req, res) => {
  try {
    const { hostelId } = req.params
    const { room_number, capacity } = req.body

    const hostelID = Number(hostelId)

    // Validate hostel ID
    if (!Number.isInteger(hostelID) || hostelID <= 0) {
      return res.status(400).json({
        message: 'Invalid hostel ID'
      })
    }

    // Validate room number
    if (
      !room_number ||
      typeof room_number !== 'string' ||
      !room_number.trim()
    ) {
      return res.status(400).json({
        message: 'Room number is required'
      })
    }

    // Validate room capacity
    const roomCapacity = Number(capacity)

    if (!Number.isInteger(roomCapacity) || roomCapacity <= 0) {
      return res.status(400).json({
        message: 'Room capacity must be a positive integer'
      })
    }

    // Check whether hostel exists
    const [hostels] = await db.query(
      'SELECT id FROM hostels WHERE id = ?',
      [hostelID]
    )

    if (hostels.length === 0) {
      return res.status(404).json({
        message: 'Hostel not found'
      })
    }

    const roomNumber = room_number.trim()

    // Check for duplicate room number in the same hostel
    const [existingRooms] = await db.query(
      `SELECT id FROM rooms
       WHERE hostel_id = ? AND LOWER(room_number) = LOWER(?)
       LIMIT 1`,
      [hostelID, roomNumber]
    )

    if (existingRooms.length > 0) {
      return res.status(409).json({
        message: 'This room number already exists in the hostel'
      })
    }

    // Create room
    const [result] = await db.query(
      `INSERT INTO rooms
       (hostel_id, room_number, capacity, currency_occupancy, status)
       VALUES (?, ?, ?, 0, 'Available')`,
      [hostelID, roomNumber, roomCapacity]
    )

    return res.status(201).json({
      message: 'Room created successfully',
      room: {
        id: result.insertId,
        hostel_id: hostelID,
        room_number: roomNumber,
        capacity: roomCapacity,
        currency_occupancy: 0,
        status: 'Available'
      }
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to create room'
    })
  }
}

// Get rooms

const getHostelRooms = async (req, res) => {
  try {
    const hostelId = Number(req.params.hostelId)

    // Validate hostel ID
    if (!Number.isInteger(hostelId) || hostelId <= 0) {
      return res.status(400).json({
        message: 'Invalid hostel ID'
      })
    }

    // Check whether hostel exists
    const [hostels] = await db.query(
      'SELECT id, name FROM hostels WHERE id = ?',
      [hostelId]
    )

    if (hostels.length === 0) {
      return res.status(404).json({
        message: 'Hostel not found'
      })
    }

    // Retrieve hostel rooms
    const [rooms] = await db.query(
      `SELECT
        id,
        hostel_id,
        room_number,
        capacity,
        currency_occupancy,
        status
       FROM rooms
       WHERE hostel_id = ?
       ORDER BY room_number ASC`,
      [hostelId]
    )

    return res.status(200).json({
      message: 'Hostel rooms retrieved successfully',
      hostel: hostels[0].name,
      total: rooms.length,
      rooms
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to retrieve hostel rooms'
    })
  }
}

// Update room

const updateRoom = async (req, res) => {
  let connection

  try {
    const roomId = Number(req.params.id)
    const { room_number, capacity, status } = req.body

    // Validate room ID
    if (!Number.isInteger(roomId) || roomId <= 0) {
      return res.status(400).json({
        message: 'Invalid room ID'
      })
    }

    // Validate room number
    if (
      !room_number ||
      typeof room_number !== 'string' ||
      !room_number.trim()
    ) {
      return res.status(400).json({
        message: 'Room number is required'
      })
    }

    // Validate capacity
    const roomCapacity = Number(capacity)

    if (!Number.isInteger(roomCapacity) || roomCapacity <= 0) {
      return res.status(400).json({
        message: 'Room capacity must be a positive integer'
      })
    }

    // Validate status
    if (!['Available', 'Maintenance'].includes(status)) {
      return res.status(400).json({
        message: 'Status must be Available or Maintenance'
      })
    }

    connection = await db.getConnection()
    await connection.beginTransaction()

    // Find and lock the room
    const [rooms] = await connection.query(
      'SELECT * FROM rooms WHERE id = ? FOR UPDATE',
      [roomId]
    )

    if (rooms.length === 0) {
      await connection.rollback()

      return res.status(404).json({
        message: 'Room not found'
      })
    }

    const currentRoom = rooms[0]
    const occupancy = Number(currentRoom.currency_occupancy)
    const hostelId = currentRoom.hostel_id

    // Prevent capacity from going below occupancy
    if (roomCapacity < occupancy) {
      await connection.rollback()

      return res.status(400).json({
        message: 'Room capacity cannot be less than current occupancy'
      })
    }

    const roomNumber = room_number.trim()

    // Check for duplicate room number in the same hostel
    const [existingRooms] = await connection.query(
      `SELECT id FROM rooms
       WHERE hostel_id = ?
       AND LOWER(room_number) = LOWER(?)
       AND id != ?
       LIMIT 1`,
      [hostelId, roomNumber, roomId]
    )

    if (existingRooms.length > 0) {
      await connection.rollback()

      return res.status(409).json({
        message: 'This room number already exists in the hostel'
      })
    }

    // Determine room status
    const roomStatus =
      occupancy >= roomCapacity ? 'Full' : status

    // Update room without changing its hostel
    await connection.query(
      `UPDATE rooms
       SET room_number = ?,
           capacity = ?,
           status = ?
       WHERE id = ?`,
      [roomNumber, roomCapacity, roomStatus, roomId]
    )

    await connection.commit()

    return res.status(200).json({
      message: 'Room updated successfully',
      room: {
        id: roomId,
        hostel_id: hostelId,
        room_number: roomNumber,
        capacity: roomCapacity,
        currency_occupancy: occupancy,
        status: roomStatus
      }
    })

  } catch (err) {
    if (connection) {
      await connection.rollback()
    }

    console.error(err)

    return res.status(500).json({
      message: 'Unable to update room'
    })

  } finally {
    if (connection) {
      connection.release()
    }
  }
}

// Delete room

const deleteRoom = async (req, res) => {
  let connection

  try {
    const roomId = Number(req.params.id)

    // Validate room ID
    if (!Number.isInteger(roomId) || roomId <= 0) {
      return res.status(400).json({
        message: 'Invalid room ID'
      })
    }

    connection = await db.getConnection()
    await connection.beginTransaction()

    // Find and lock room
    const [rooms] = await connection.query(
      'SELECT * FROM rooms WHERE id = ? FOR UPDATE',
      [roomId]
    )

    if (rooms.length === 0) {
      await connection.rollback()

      return res.status(404).json({
        message: 'Room not found'
      })
    }

    const room = rooms[0]

    // Check occupancy
    if (Number(room.currency_occupancy) > 0) {
      await connection.rollback()

      return res.status(409).json({
        message: 'Cannot delete an occupied room'
      })
    }

    // Check existing allocation records
    const [allocations] = await connection.query(
      'SELECT id FROM allocations WHERE room_id = ? LIMIT 1',
      [roomId]
    )

    if (allocations.length > 0) {
      await connection.rollback()

      return res.status(409).json({
        message: 'Cannot delete a room with existing allocation records'
      })
    }

    // Delete room
    await connection.query(
      'DELETE FROM rooms WHERE id = ?',
      [roomId]
    )

    await connection.commit()

    return res.status(200).json({
      message: 'Room deleted successfully'
    })

  } catch (err) {
    if (connection) {
      await connection.rollback()
    }

    console.error(err)

    return res.status(500).json({
      message: 'Unable to delete room'
    })

  } finally {
    if (connection) {
      connection.release()
    }
  }
}

// Get all rooms

const getAllRooms = async (req, res) => {
  try {
    const { hostel_id } = req.query

    let query = `
      SELECT
        r.id,
        r.hostel_id,
        h.name AS hostel_name,
        r.room_number,
        r.capacity,
        r.currency_occupancy,
        CASE
          WHEN r.status = 'Maintenance' THEN 0
          ELSE GREATEST(
            r.capacity - r.currency_occupancy, 0
          )
        END AS available_spaces,
        r.status
      FROM rooms r
      JOIN hostels h ON r.hostel_id = h.id
    `

    const values = []

    if (hostel_id !== undefined) {
      const hostelId = Number(hostel_id)

      if (!Number.isInteger(hostelId) || hostelId <= 0) {
        return res.status(400).json({
          message: 'Invalid hostel ID'
        })
      }

      query += ' WHERE r.hostel_id = ?'
      values.push(hostelId)
    }

    query += ' ORDER BY h.name, r.room_number'

    const [rooms] = await db.query(query, values)

    return res.status(200).json({
      message: 'Rooms retrieved successfully',
      total: rooms.length,
      rooms
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to retrieve rooms'
    })
  }
}

// Get dashboard stats

const getDashboardStats = async (req, res) => {
  try {
    const [
      [studentResult],
      [hostelResult],
      [roomResult],
      [applicationResult],
      [spaceResult]
    ] = await Promise.all([
      db.query(
        'SELECT COUNT(*) AS total_students FROM students'
      ),

      db.query(
        'SELECT COUNT(*) AS total_hostels FROM hostels'
      ),

      db.query(
        'SELECT COUNT(*) AS total_rooms FROM rooms'
      ),

      db.query(
        `SELECT
          COUNT(CASE WHEN status = 'Pending' THEN 1 END) AS pending_applications,
          COUNT(CASE WHEN status = 'Granted' THEN 1 END) AS granted_applications,
          COUNT(CASE WHEN status = 'Rejected' THEN 1 END) AS rejected_applications
         FROM allocations`
      ),

      db.query(
        `SELECT
          COALESCE(
            SUM(
              CASE
                WHEN status != 'Maintenance'
                THEN GREATEST(capacity - currency_occupancy, 0)
                ELSE 0
              END
            ), 0
          ) AS available_spaces
         FROM rooms`
      )
    ])

    return res.status(200).json({
      message: 'Dashboard statistics retrieved successfully',
      statistics: {
        total_students: studentResult[0].total_students,
        total_hostels: hostelResult[0].total_hostels,
        total_rooms: roomResult[0].total_rooms,
        pending_applications: applicationResult[0].pending_applications,
        granted_applications: applicationResult[0].granted_applications,
        rejected_applications: applicationResult[0].rejected_applications,
        available_spaces: spaceResult[0].available_spaces
      }
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to retrieve dashboard statistics'
    })
  }
}

module.exports = { getAdminProfile, getPendingApplications,grantApplication, rejectApplication, getAllHostels, addHostel, updateHostel, deleteHostel, addRoom, getHostelRooms, updateRoom, deleteRoom, getAllRooms, getDashboardStats}