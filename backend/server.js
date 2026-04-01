import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const app  = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  const ALLOWED = [
    'https://2-nu-eight.vercel.app',
    'http://localhost:8080',
    'http://localhost:3000',
    'http://localhost:5500',
    'https://skillmart-production-eb9d.up.railway.app',
    'https://2-h1b61l0p4-rizens-projects-3d6c042b.vercel.app',
  ];

  const origin = req.headers.origin;
  if (ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    // preflight запрос — сразу отвечаем 200
    return res.sendStatus(200);
  }

  next();
});

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
    servers: [{ url: 'https://skillmart-production-eb9d.up.railway.app/api' }, { url: '/api' }],
    components: { securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  },
  apis: ['./routes/*.js'],
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.set('trust proxy', 1); // ставим 1, чтобы Express понимал заголовок X-Forwarded-For

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


try {
  const [rows] = await conn.execute('SELECT * FROM orders LIMIT ?', [limitNum]);
  res.json(rows);
} catch (e) {
  console.error('❌ Orders error:', e);
  res.status(500).json({ error: e.message });
}