# Деплой Skillmart на Render (MySQL)

## Архитектура
```
backend/  → Web Service (Node.js)  → https://skillmart-7agy.onrender.com
frontend/ → Static Site            → https://skillmart-1.onrender.com
БД        → внешний MySQL хостинг
```

---

## 1. Загрузи код на GitHub

```bash
cd skillmart/
git init
git add .
git commit -m "skillmart mysql"
git remote add origin https://github.com/ТВОЙ/skillmart.git
git push -u origin main
```

---

## 2. MySQL база данных

**Render не предоставляет бесплатный MySQL.** Используй один из вариантов:

### Вариант А — PlanetScale (рекомендуется, бесплатно)
1. Зайди на [planetscale.com](https://planetscale.com) → Create database
2. Name: `skillmart`, Region: ближайший
3. Connect → Prisma → скопируй connection string вида:
   `mysql://user:pass@host/skillmart?sslaccept=strict`
4. Замени `?sslaccept=strict` → добавится в код автоматически

### Вариант Б — Railway MySQL (бесплатный тариф)
1. [railway.app](https://railway.app) → New Project → Add MySQL
2. Скопируй `MYSQL_URL` из Variables

### Вариант В — локальный MySQL для разработки
```bash
# В backend/ создай файл .env:
DB_HOST=localhost
DB_PORT=3306
DB_NAME=skillmart
DB_USER=root
DB_PASSWORD=your_password
JWT_SECRET=local_secret_here
```

---

## 3. Задеплой Backend на Render

1. Render Dashboard → **New → Web Service** → подключи GitHub репо
2. Root directory: `backend`
3. Build Command: `npm install`
4. Start Command: `node server.js`

**Environment Variables:**
| Key | Value |
|-----|-------|
| `DATABASE_URL` | *(вставь строку подключения из шага 2)* |
| `JWT_SECRET` | *(длинная случайная строка)* |
| `NODE_ENV` | `production` |

---

## 4. Примени схему БД

После первого деплоя — в Render Dashboard → твой сервис → **Shell**:
```bash
node scripts/init-db.js
```

Или запусти локально с переменной окружения:
```bash
DATABASE_URL=mysql://... node scripts/init-db.js
```

---

## 5. Задеплой Frontend

Render → **New → Static Site** → тот же репо:
- Root directory: `frontend`  
- Publish directory: `.`
- Build command: *(пусто)*

---

## 6. Проверь

- Health: https://skillmart-7agy.onrender.com/health
- Swagger: https://skillmart-7agy.onrender.com/docs
- Сайт: https://skillmart-1.onrender.com

---

## Локальная разработка

```bash
# Backend
cd backend
cp .env.example .env
# заполни .env
npm install
node scripts/init-db.js  # применить схему
npm start

# Frontend - просто открой index.html или используй Live Server
```

> **Важно:** Free план Render засыпает через 15 мин неактивности.
> Первый запрос после сна займёт ~30 секунд.
