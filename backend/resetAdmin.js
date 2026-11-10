
const bcrypt = require('bcrypt')
const db = require('./config/db')

const resetPassword = async () => {
  try {
    const newPassword = 'adminfirstpassword'

    const hashedPassword = await bcrypt.hash(newPassword, 10)

    await db.query(
      'UPDATE admins SET password_hash = ? WHERE username = ?',
      [hashedPassword, 'admin']
    )

    console.log('Admin password updated successfully!')
  } catch (error) {
    console.error('Error:', error.message)
  } finally {
    await db.end()
  }
}

resetPassword()
