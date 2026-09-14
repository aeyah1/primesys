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
const { ipKeyGenerator } = require('express-rate-limit')
const cron      = require('node-cron')
const { sendDueReminders } = require('./controllers/reminders.controller')
const { loadUserState, tokenRevoked } = require('./middleware/auth.middleware')

const app    = express()
// Behind a hosting proxy, req.ip must be the visitor's address so rate limits apply per visitor.
if (config.trustProxy) app.set('trust proxy', config.trustProxy)
const server = http.createServer(app)
const io     = new Server(server, {
  cors: { origin: config.clientUrl, credentials: true }
})

app.use(helmet())
app.use(cors({ origin: config.clientUrl, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// Uptime monitors ping this to keep a free host from sleeping; it reveals nothing.
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Key requests by user ID when a valid JWT is present, else by IP.
// Per-user buckets stop co-located teammates (same office NAT) from
// sharing one budget. IP fallback still caps unauth traffic
// (login attempts, registration, expired tokens, abuse).
function userOrIpKey(req, res) {
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), config.jwt.secret, { algorithms: ['HS256'] })
      if (payload && payload.id) return `u:${payload.id}`
    } catch { /* invalid/expired → fall through to IP */ }
  }
  return `ip:${ipKeyGenerator(req, res)}`
}

// Global rate limiter - 300 per 15 min per user (1000 per IP fallback for unauth traffic)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => req.headers.authorization?.startsWith('Bearer ') ? 300 : 1000,
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
})

// Write operations (POST/PATCH/DELETE) - 100 per 15 min per user (300 per IP fallback)
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => req.headers.authorization?.startsWith('Bearer ') ? 100 : 300,
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many write requests, please slow down.' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || req.path.startsWith('/auth/'),
})

// Endpoint-specific limits for sign-up, sign-in, and emails live in
// routes/auth.routes.js, next to the routes they protect.
app.use('/api/', apiLimiter)
app.use('/api/', writeLimiter)

// Attach socket.io to every request so controllers can emit events
app.use((req, _, next) => { req.io = io; next() })

app.use('/api/auth',          require('./routes/auth.routes'))
app.use('/api/users',         require('./routes/users.routes'))
app.use('/api/quarters',      require('./routes/quarters.routes'))
app.use('/api/settings',      require('./routes/settings.routes'))
app.use('/api/pr',            require('./routes/pr.routes'))
app.use('/api/lots',          require('./routes/lots.routes'))
app.use('/api/canvass',       require('./routes/canvass.routes'))
app.use('/api/po',            require('./routes/po.routes'))
app.use('/api/delivery',      require('./routes/delivery.routes'))
app.use('/api/notifications', require('./routes/notifications.routes'))
app.use('/api/reminders',     require('./routes/reminders.routes'))
app.use('/api/reports',       require('./routes/reports.routes'))
app.use('/api/twg',           require('./routes/twg.routes'))

app.use((err, req, res, next) => {
  // Client-facing 4xx errors (status set explicitly, e.g. a workflow rule
  // rejecting a move) return their message and are not logged: they are
  // expected outcomes, not faults.
  if (err.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ message: err.message || 'Request failed' })
  }
  // Everything else is logged in full server-side and masked as a generic 500
  // so internal details (SQL fragments, file paths, etc.) don't leak.
  console.error(err)
  res.status(err.status || 500).json({ message: 'Internal server error' })
})

// Socket.IO - require a valid, current JWT for an active account
// (Deactivating a user or changing their password also disconnects their open
// sockets; see users.controller and auth.middleware.endSessions.)
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token
  if (!token) return next(new Error('Authentication required'))
  try {
    socket.user = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] })
  } catch {
    return next(new Error('Invalid or expired token'))
  }
  try {
    const state = await loadUserState(socket.user.id)
    if (!state.active) return next(new Error('Account deactivated'))
    if (tokenRevoked(socket.user, state)) return next(new Error('Session ended'))
    next()
  } catch {
    next(new Error('Service temporarily unavailable'))   // fail closed
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

// Wrap in try/catch so a transient DB connection drop or mail failure
// doesn't propagate out of the cron task (node-cron silently swallows errors).
cron.schedule('* * * * *', async () => {
  try {
    await sendDueReminders()
  } catch (err) {
    console.error('[cron] sendDueReminders failed:', err.message)
  }
})

server.listen(config.port, () => {
  console.log(`PRimeSys server running on http://localhost:${config.port}`)
  require('./db/pool').checkClock()
})
