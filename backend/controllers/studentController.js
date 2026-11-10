const db = require('../config/db')

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

module.exports = { getStudentProfile }