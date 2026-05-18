const config = require('./config')
try { config.validate() } catch (err) {
  console.error(`[startup] ${err.message}`)
  process.exit(1)
}

const express   = require('express')
const http      = require('http')
const { Server } = require('socket.io')
const cors      = require('cors')
const helmet    = require('helmet')
const jwt       = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const cron      = require('node-cron')
const { sendDueReminders } = require('./controllers/reminders.controller')

const app    = express()
const server = http.createServer(app)
const io     = new Server(server, {
  cors: { origin: config.clientUrl, credentials: true }
})

app.use(helmet())
app.use(cors({ origin: config.clientUrl, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// Global rate limiter — 150 requests per 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
})

// Write operations (POST/PATCH/DELETE) — 60 per 15 min per IP
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many write requests, please slow down.' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || req.path.startsWith('/auth/'),
})

// Email-sending endpoints — 5 per hour per IP
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait before trying again.' },
  skipSuccessfulRequests: false,
})

app.use('/api/', apiLimiter)
app.use('/api/', writeLimiter)
app.use('/api/auth/forgot-password',     emailLimiter)
app.use('/api/auth/resend-verification', emailLimiter)

// Attach socket.io to every request so controllers can emit events
app.use((req, _, next) => { req.io = io; next() })

app.use('/api/auth',          require('./routes/auth.routes'))
app.use('/api/users',         require('./routes/users.routes'))
app.use('/api/quarters',      require('./routes/quarters.routes'))
app.use('/api/settings',      require('./routes/settings.routes'))
app.use('/api/pr',            require('./routes/pr.routes'))
app.use('/api/lots',          require('./routes/lots.routes'))
app.use('/api/po',            require('./routes/po.routes'))
app.use('/api/delivery',      require('./routes/delivery.routes'))
app.use('/api/notifications', require('./routes/notifications.routes'))
app.use('/api/reminders',     require('./routes/reminders.routes'))
app.use('/api/reports',       require('./routes/reports.routes'))

app.use((err, req, res, next) => {
  // Always log the full error server-side.
  console.error(err)
  // Only expose the message to clients for client-facing 4xx errors (status set
  // explicitly by the controller). For everything else, return a generic 500
  // so internal details (SQL fragments, file paths, etc.) don't leak.
  if (err.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ message: err.message || 'Request failed' })
  }
  res.status(err.status || 500).json({ message: 'Internal server error' })
})

// ── Socket.IO — require valid JWT in handshake ────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token
  if (!token) return next(new Error('Authentication required'))
  try {
    socket.user = jwt.verify(token, config.jwt.secret)
    next()
  } catch {
    next(new Error('Invalid or expired token'))
  }
})

io.on('connection', (socket) => {
  // Only let the authenticated user join their own notification room
  socket.on('join', (userId) => {
    if (userId && parseInt(userId) === socket.user.id) {
      socket.join(`user_${socket.user.id}`)
    }
  })
})
// ─────────────────────────────────────────────────────────

cron.schedule('* * * * *', sendDueReminders)

server.listen(config.port, () => console.log(`PRimeSys server running on http://localhost:${config.port}`))
