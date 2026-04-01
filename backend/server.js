require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const swaggerUi    = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ────────────────────────────────────────────────────
const ALLOWED = [
  '2-nu-eight.vercel.app',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:5500', // VS Code Live Server
  'https://skillmart-production-eb9d.up.railway.app',  
];
app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, Postman, mobile apps)
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors()); // preflight for all routes

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ── RATE LIMITS ──────────────────────────────────────────────
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
app.use('/api',      rateLimit({ windowMs: 60 * 1000, max: 300 }));

// ── SWAGGER ──────────────────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Skillmart API', version: '1.0.0' },
    servers: [{ url: 'https://skillmart-7agy.onrender.com/api' }, { url: '/api' }],
    components: { securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  },
  apis: ['./routes/*.js'],
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── ROUTES ───────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/categories',    require('./routes/categories'));
app.use('/api/services',      require('./routes/services'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/reviews',       require('./routes/reviews'));
app.use('/api/balance',       require('./routes/balance'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/admin',         require('./routes/admin'));

app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date(), env: process.env.NODE_ENV }));
app.use((_, res) => res.status(404).json({ error: 'Маршрут не найден' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀 Skillmart API on port ${PORT}\n📖 Docs: /docs`)
);
