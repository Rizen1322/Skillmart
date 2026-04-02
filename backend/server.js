require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

const ALLOWED = [
  'https://2-nu-eight.vercel.app',
  'https://2-h1b61l0p4-rizens-projects-3d6c042b.vercel.app',
  'https://2-production-ab08.up.railway.app',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:5500',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    console.warn(`[cors] отклонён запрос от: "${origin}" — не входит в список разрешённых: ${ALLOWED.join(', ')}`);
    cb(new Error(`cors: источник ${origin} не разрешён`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.options('*', cors());

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));
app.use('/api',      rateLimit({ windowMs: 60 * 1000,       max: 300 }));

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

app.get('/health', (_, res) => res.json({ ok: true, time: new Date() }));
app.use((_, res) => res.status(404).json({ error: 'маршрут не найден' }));
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || 'внутренняя ошибка' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`сервер запущен на порту ${PORT}`));
