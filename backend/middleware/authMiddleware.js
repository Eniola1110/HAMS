const jwt = require('jsonwebtoken')

const verifyToken = (req, res, next) => {
  try {
    // GET TOKEN FROM REQUEST HEADER
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'Access denied. No token provided'
      })
    }

    // EXTRACT TOKEN
    const token = authHeader.split(' ')[1]

    // VERIFY TOKEN
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // ATTACH USER INFORMATION TO REQUEST
    req.user = decoded

    next()

  } catch (err) {
    return res.status(401).json({
      message: 'Invalid or expired token'
    })
  }
}

module.exports = verifyToken
