const db = require('../config/db')

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

module.exports = { getAdminProfile }