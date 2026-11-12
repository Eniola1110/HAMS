const db = require('../config/db')
const crypto = require('crypto')

// get student profile
const getStudentProfile = async (req, res) => {
  try {
    const sql = `
      SELECT id, matric_no, surname, first_name,
             middle_name, email, gender, level,
             department, college
      FROM students
      WHERE id = ?
    `

    const [results] = await db.query(sql, [req.user.id])

    if (results.length === 0) {
      return res.status(404).json({
        message: 'Student not found'
      })
    }

    return res.status(200).json({
      message: 'Student profile retrieved successfully',
      student: results[0]
    })

  } catch (err) {
    return res.status(500).json({
      message: 'Unable to retrieve student profile'
    })
  }
}

// get available hostels

const getAvailableHostels = async (req, res) => {
  try {
    // Get the logged-in student's gender
    const [students] = await db.query(
      'SELECT gender FROM students WHERE id = ?',
      [req.user.id]
    )

    if (students.length === 0) {
      return res.status(404).json({
        message: 'Student not found'
      })
    }

    const studentGender = students[0].gender

    // Retrieve all hostels matching the student's gender
    const sql = `
  SELECT
    h.id,
    h.name,
    h.gender_type,
    h.total_capacity,
    COALESCE(SUM(r.capacity), 0) AS registered_room_capacity,
    COALESCE(SUM(r.currency_occupancy), 0) AS occupied_spaces,
    COALESCE(
      SUM(
        CASE
          WHEN r.status != 'Maintenance'
          THEN GREATEST(r.capacity - r.currency_occupancy, 0)
          ELSE 0
        END
      ), 0
    ) AS available_spaces
  FROM hostels h
  LEFT JOIN rooms r ON h.id = r.hostel_id
  WHERE h.gender_type = ?
  GROUP BY h.id, h.name, h.gender_type, h.total_capacity
`

    const [hostels] = await db.query(sql, [studentGender])

    return res.status(200).json({
      message: 'Hostels retrieved successfully',
      hostels
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to retrieve hostels'
    })
  }
}

// submit hostel application

const submitHostelApplication = async (req, res) => {
  let connection
  let transactionStarted = false

  try {
    const preferredHostelId = Number(req.body?.preferred_hostel_id)

    // Validate the hostel ID
    if (!Number.isInteger(preferredHostelId) || preferredHostelId <= 0) {
      return res.status(400).json({
        message: 'Please provide a valid hostel ID'
      })
    }

    connection = await db.getConnection()

    await connection.beginTransaction()
    transactionStarted = true

    // Helper for safely rejecting a request inside a transaction
    const rejectRequest = async (status, message) => {
      await connection.rollback()
      transactionStarted = false

      return res.status(status).json({ message })
    }

    // 1. Retrieve and lock the student's record
    const [students] = await connection.query(
      `SELECT id, gender
       FROM students
       WHERE id = ?
       FOR UPDATE`,
      [req.user.id]
    )

    if (students.length === 0) {
      return await rejectRequest(404, 'Student not found')
    }

    const studentGender = students[0].gender

    // 2. Check for an existing pending application
    const [pendingApplications] = await connection.query(
      `SELECT id
       FROM allocations
       WHERE student_id = ?
       AND status = 'Pending'
       LIMIT 1`,
      [req.user.id]
    )

    if (pendingApplications.length > 0) {
      return await rejectRequest(
        409,
        'You already have a pending hostel application'
      )
    }

    // 3. Prevent a student with an existing allocation from applying again
    const [grantedAllocations] = await connection.query(
      `SELECT id
       FROM allocations
       WHERE student_id = ?
       AND status = 'Granted'
       LIMIT 1`,
      [req.user.id]
    )

    if (grantedAllocations.length > 0) {
      return await rejectRequest(
        409,
        'You already have a hostel allocation'
      )
    }

    // 4. Retrieve the selected hostel
    const [hostels] = await connection.query(
      `SELECT
         h.id,
         h.name,
         h.gender_type,
         EXISTS (
           SELECT 1
           FROM rooms r
           WHERE r.hostel_id = h.id
           AND r.status = 'Available'
           AND COALESCE(r.currency_occupancy, 0) < COALESCE(r.capacity, 0)
         ) AS has_available_room
       FROM hostels h
       WHERE h.id = ?`,
      [preferredHostelId]
    )

    if (hostels.length === 0) {
      return await rejectRequest(404, 'Selected hostel not found')
    }

    const selectedHostel = hostels[0]

    // 5. Validate hostel gender
    if (selectedHostel.gender_type !== studentGender) {
      return await rejectRequest(
        403,
        'You cannot apply for a hostel that does not match your gender'
      )
    }

    // 6. Check room availability
    if (!selectedHostel.has_available_room) {
      return await rejectRequest(
        409,
        'This hostel currently has no available room spaces'
      )
    }

    // 7. Generate an application reference code
    const referenceCode = `HAMS-${Date.now()}-${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`

    // 8. Save the application
    const [result] = await connection.query(
      `INSERT INTO allocations
       (student_id, preferred_hostel_id, status, reference_code)
       VALUES (?, ?, 'Pending', ?)`,
      [req.user.id, preferredHostelId, referenceCode]
    )

    await connection.commit()
    transactionStarted = false

    return res.status(201).json({
      message: 'Hostel application submitted successfully',
      application: {
        id: result.insertId,
        reference_code: referenceCode,
        preferred_hostel: selectedHostel.name,
        status: 'Pending'
      }
    })

  } catch (err) {
    if (transactionStarted && connection) {
      await connection.rollback()
    }

    console.error(err)

    return res.status(500).json({
      message: 'Unable to submit hostel application'
    })

  } finally {
    if (connection) {
      connection.release()
    }
  }
}

// get application

const getStudentApplications = async (req, res) => {
  try {
    const sql = `
      SELECT
        a.id AS application_id,
        a.reference_code,
        a.status,
        a.requested_at,
        a.actioned_at,
        a.action_reason,

        h.name AS preferred_hostel,

        r.room_number,
        r.capacity AS room_capacity

      FROM allocations a

      LEFT JOIN hostels h
        ON a.preferred_hostel_id = h.id

      LEFT JOIN rooms r
        ON a.room_id = r.id

      WHERE a.student_id = ?

      ORDER BY a.requested_at DESC
    `

    const [applications] = await db.query(sql, [req.user.id])

    return res.status(200).json({
      message: 'Student applications retrieved successfully',
      total: applications.length,
      applications
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to retrieve student applications'
    })
  }
}

// get student allocation

const getStudentAllocation = async (req, res) => {
  try {
    const studentId = req.user.id

    const [allocations] = await db.query(
      `SELECT
        a.id AS application_id,
        a.reference_code,
        a.status,
        a.actioned_at AS allocated_at,
        h.id AS hostel_id,
        h.name AS hostel_name,
        r.id AS room_id,
        r.room_number,
        r.capacity
       FROM allocations a
       JOIN hostels h ON a.preferred_hostel_id = h.id
       JOIN rooms r ON a.room_id = r.id
       WHERE a.student_id = ?
       AND a.status = 'Granted'
       ORDER BY a.actioned_at DESC
       LIMIT 1`,
      [studentId]
    )

    if (allocations.length === 0) {
      return res.status(404).json({
        message: 'You do not have an active hostel allocation'
      })
    }

    return res.status(200).json({
      message: 'Allocation details retrieved successfully',
      allocation: allocations[0]
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unable to retrieve allocation details'
    })
  }
}


module.exports = { getStudentProfile, getAvailableHostels, submitHostelApplication, getStudentApplications, getStudentAllocation }