const express = require('express')
const cors = require('cors')
require('dotenv').config()

const authRoutes = require('./routes/authRoutes')
const studentRoutes = require('./routes/studentRoutes')
const adminRoutes = require('./routes/adminRoutes')
const verifyToken = require('./middleware/authMiddleware')
const authorizeRoles = require('./middleware/roleMiddleware')

const app = express()

app.use(cors())
app.use(express.json())

app.get('/api/protected', verifyToken, (req, res) => {
  res.json({
    message: 'You have accessed a protected route',
    user: req.user
  })
})

app.get(
  '/api/student-only',
  verifyToken,
  authorizeRoles('student'),
  (req, res) => {
    res.json({
      message: 'Welcome! You have student access.',
      user: req.user
    })
  }
)

app.get(
  '/api/admin-only',
  verifyToken,
  authorizeRoles('admin'),
  (req, res) => {
    res.json({
      message: 'Welcome! You have admin access.',
      user: req.user
    })
  }
)

app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`)
  next()
})

app.use('/api/auth', authRoutes)
app.use('/api/student', studentRoutes)
app.use('/api/admin', adminRoutes)

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
