const bcrypt = require('bcrypt')
const db = require('../config/db.js')
const jwt = require('jsonwebtoken')

// VERIFY MATRIC NUMBER
const verify_matric_no = async (req, res) => {
  const { matric_no } = req.body

  try {
    if (!matric_no) {
      return res.status(400).json({
        message: 'Matric number is required'
      })
    }

    const checkSql = `
      SELECT matric_no, surname, first_name, middle_name,
             gender, level, department, college, is_registered
      FROM pre_approved_students
      WHERE matric_no = ?
    `

    const [results] = await db.query(checkSql, [matric_no])

    if (results.length === 0) {
      return res.status(404).json({
        message: 'Matric number not found in the institutional registry'
      })
    }

    if (results[0].is_registered) {
      return res.status(400).json({
        message: 'This matric number has already been registered'
      })
    }

    return res.status(200).json({
      message: 'Matric number verified successfully',
      student: results[0]
    })

  } catch (err) {
    return res.status(500).json({
      message: err.message
    })
  }
}


// STUDENT REGISTRATION
const register = async (req, res) => {
  const { matric_no, email, password } = req.body

  let connection

  try {
    if (!matric_no || !email || !password) {
      return res.status(400).json({
        message: 'Matric number, email and password are required'
      })
    }

    connection = await db.getConnection()

    // START TRANSACTION
    await connection.beginTransaction()

    // CHECK STUDENT ELIGIBILITY
    const checkSql = `
      SELECT * FROM pre_approved_students
      WHERE matric_no = ? AND is_registered = FALSE
      FOR UPDATE
    `

    const [results] = await connection.query(checkSql, [matric_no])

    if (results.length === 0) {
      await connection.rollback()

      return res.status(400).json({
        message: 'Student is ineligible or already registered'
      })
    }

    const student = results[0]

    // HASH PASSWORD
    const hashedPassword = await bcrypt.hash(password, 10)

    // INSERT STUDENT
    const insertSql = `
      INSERT INTO students
      (matric_no, surname, first_name, middle_name, email,
       password_hash, gender, level, department, college)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    await connection.query(insertSql, [
      student.matric_no,
      student.surname,
      student.first_name,
      student.middle_name,
      email,
      hashedPassword,
      student.gender,
      student.level,
      student.department,
      student.college
    ])

    // UPDATE REGISTRATION STATUS
    const updateSql = `
      UPDATE pre_approved_students
      SET is_registered = TRUE
      WHERE matric_no = ?
    `

    await connection.query(updateSql, [matric_no])

    // COMMIT TRANSACTION
    await connection.commit()

    return res.status(201).json({
      message: 'Registration successful! You can now log in'
    })

  } catch (err) {

    if (connection) {
      await connection.rollback()
    }

    return res.status(500).json({
      message: err.message
    })

  } finally {
    if (connection) {
      connection.release()
    }
  }
}

// STUDENT LOGIN

const login = async (req, res) => {
  const { matric_no, password } = req.body

  console.log(req.body)

  try {
    // CHECK REQUIRED FIELDS
    if (!matric_no || !password) {
      return res.status(400).json({
        message: 'Matric number and password are required'
      })
    }

    // FIND STUDENT
    const sql = `
      SELECT id, matric_no, surname, first_name,
             email, password_hash, gender, level,
             department, college
      FROM students
      WHERE matric_no = ?
    `

    const [results] = await db.query(sql, [matric_no])

    if (results.length === 0) {
      return res.status(401).json({
        message: 'Invalid matric number or password'
      })
    }

    const student = results[0]

    // COMPARE PASSWORD
    const isPasswordValid = await bcrypt.compare(
      password,
      student.password_hash
    )

    if (!isPasswordValid) {
      return res.status(401).json({
        message: 'Invalid matric number or password'
      })
    }

    // GENERATE JWT
    const token = jwt.sign(
  {
    id: student.id,
    matric_no: student.matric_no,
    role: 'student'
  },
  process.env.JWT_SECRET,
  {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d'
  }
)
    // REMOVE PASSWORD HASH FROM RESPONSE
    delete student.password_hash

    return res.status(200).json({
      message: 'Login successful',
      token,
      student
    })

  } catch (err) {
    return res.status(500).json({
      message: err.message
    })
  }
}

// ADMIN LOGIN

const adminLogin = async (req, res) => {
  const { username, password } = req.body

  try {
    if (!username || !password) {
      return res.status(400).json({
        message: 'Username and password are required'
      })
    }

    const sql = `
      SELECT id, username, password_hash, full_name
      FROM admins
      WHERE username = ?
    `

    const [results] = await db.query(sql, [username])

    if (results.length === 0) {
      return res.status(401).json({
        message: 'Invalid username or password'
      })
    }

    const admin = results[0]

    const isPasswordValid = await bcrypt.compare(
      password,
      admin.password_hash
    )

    if (!isPasswordValid) {
      return res.status(401).json({
        message: 'Invalid username or password'
      })
    }

    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        role: 'admin'
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d'
      }
    )

    return res.status(200).json({
      message: 'Admin login successful',
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        full_name: admin.full_name
      }
    })

  } catch (err) {
    return res.status(500).json({
      message: 'An error occurred during admin login'
    })
  }
}

module.exports = { verify_matric_no, register, login, adminLogin }
