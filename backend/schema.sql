SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('customer','executor','admin') NOT NULL,
  avatar        MEDIUMTEXT,
  bio           TEXT,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id          INT          NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) NOT NULL,
  description TEXT,
  icon        VARCHAR(10),
  sort_order  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cat_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO categories (name, slug, icon, description, sort_order) VALUES
  ('Дизайн',           'design',       '🎨', 'Логотипы, UI/UX, иллюстрации, брендинг',      1),
  ('Программирование', 'programming',  '💻', 'Сайты, приложения, боты, автоматизация',       2),
  ('Тексты',           'writing',      '✍️', 'Копирайтинг, SEO, переводы, рерайтинг',        3),
  ('Маркетинг',        'marketing',    '📣', 'SMM, реклама, аналитика, email-маркетинг',     4),
  ('Видео',            'video',        '🎬', 'Монтаж, анимация, съёмка, моушн-дизайн',       5),
  ('Фото',             'photo',        '📸', 'Обработка фото, ретушь, предметная съёмка',    6),
  ('Музыка и аудио',   'audio',        '🎵', 'Сочинение, сведение, озвучка, джинглы',        7),
  ('Анимация и 3D',    'animation',    '🎭', '2D/3D анимация, визуализация, моделирование',  8),
  ('Аккаунтинг',       'accounting',   '📊', 'Бухгалтерия, налоги, финансовый учёт',         9),
  ('Юридические',      'legal',        '⚖️', 'Договоры, консультации, регистрация бизнеса', 10),
  ('Обучение',         'education',    '📚', 'Репетиторство, онлайн-курсы, вебинары',       11),
  ('ИИ и нейросети',   'ai',           '🤖', 'Промпты, fine-tuning, автоматизация с ИИ',   12),
  ('Мобильные',        'mobile',       '📱', 'iOS, Android, Flutter, React Native',          13),
  ('Игры',             'games',        '🎮', 'Разработка игр, моддинг, геймдизайн',          14),
  ('Другое',           'other',        '🔧', 'Прочие цифровые услуги',                       15);

CREATE TABLE IF NOT EXISTS services (
  id            CHAR(36)       NOT NULL,
  executor_id   CHAR(36)       NOT NULL,
  category_id   INT            NOT NULL,
  title         VARCHAR(200)   NOT NULL,
  description   TEXT           NOT NULL,
  price         DECIMAL(12,2)  NOT NULL,
  deadline      INT            NOT NULL,
  is_active     TINYINT(1)     NOT NULL DEFAULT 1,
  tags          JSON,
  is_negotiable TINYINT(1)     NOT NULL DEFAULT 0,
  rating        DECIMAL(3,2)   NOT NULL DEFAULT 0.00,
  reviews_count INT            NOT NULL DEFAULT 0,
  orders_count  INT            NOT NULL DEFAULT 0,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_svc_executor  (executor_id),
  KEY idx_svc_category  (category_id),
  KEY idx_svc_active    (is_active),
  CONSTRAINT fk_svc_user FOREIGN KEY (executor_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_svc_cat  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id            CHAR(36)      NOT NULL,
  service_id    CHAR(36)      NOT NULL,
  customer_id   CHAR(36)      NOT NULL,
  executor_id   CHAR(36)      NOT NULL,
  status        ENUM('created','in_progress','review','completed','cancelled') NOT NULL DEFAULT 'created',
  total_price   DECIMAL(12,2) NOT NULL,
  deadline_date DATE,
  requirements  TEXT,
  cancel_reason TEXT,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ord_customer (customer_id),
  KEY idx_ord_executor (executor_id),
  KEY idx_ord_status   (status),
  CONSTRAINT fk_ord_svc  FOREIGN KEY (service_id)  REFERENCES services(id),
  CONSTRAINT fk_ord_cust FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_ord_exec FOREIGN KEY (executor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_status_log (
  id         INT      NOT NULL AUTO_INCREMENT,
  order_id   CHAR(36) NOT NULL,
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  changed_by CHAR(36),
  note       TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_log_order (order_id),
  CONSTRAINT fk_log_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id         CHAR(36)     NOT NULL,
  order_id   CHAR(36)     NOT NULL,
  sender_id  CHAR(36)     NOT NULL,
  message    TEXT         NOT NULL,
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_msg_order (order_id),
  CONSTRAINT fk_msg_order  FOREIGN KEY (order_id)  REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  id          CHAR(36)     NOT NULL,
  order_id    CHAR(36)     NOT NULL,
  service_id  CHAR(36)     NOT NULL,
  customer_id CHAR(36)     NOT NULL,
  executor_id CHAR(36)     NOT NULL,
  rating      TINYINT      NOT NULL,
  comment     TEXT,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rev_order  (order_id),
  KEY idx_rev_service  (service_id),
  KEY idx_rev_executor (executor_id),
  CONSTRAINT fk_rev_order   FOREIGN KEY (order_id)   REFERENCES orders(id),
  CONSTRAINT fk_rev_service FOREIGN KEY (service_id) REFERENCES services(id),
  CONSTRAINT fk_rev_cust    FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_rev_exec    FOREIGN KEY (executor_id) REFERENCES users(id),
  CONSTRAINT chk_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER IF NOT EXISTS trg_svc_rating_ins
AFTER INSERT ON reviews FOR EACH ROW
BEGIN
  UPDATE services SET
    rating        = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE service_id = NEW.service_id),
    reviews_count = (SELECT COUNT(*) FROM reviews WHERE service_id = NEW.service_id)
  WHERE id = NEW.service_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_svc_rating_upd
AFTER UPDATE ON reviews FOR EACH ROW
BEGIN
  UPDATE services SET
    rating        = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE service_id = NEW.service_id),
    reviews_count = (SELECT COUNT(*) FROM reviews WHERE service_id = NEW.service_id)
  WHERE id = NEW.service_id;
END;

CREATE TABLE IF NOT EXISTS balances (
  id         INT           NOT NULL AUTO_INCREMENT,
  user_id    CHAR(36)      NOT NULL,
  amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bal_user (user_id),
  CONSTRAINT fk_bal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id          CHAR(36)      NOT NULL,
  user_id     CHAR(36)      NOT NULL,
  order_id    CHAR(36),
  type        ENUM('deposit','withdrawal','payment') NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  description TEXT,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tx_user  (user_id),
  KEY idx_tx_order (order_id),
  CONSTRAINT fk_tx_user  FOREIGN KEY (user_id)  REFERENCES users(id),
  CONSTRAINT fk_tx_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)     NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  type       VARCHAR(50)  NOT NULL,
  title      VARCHAR(200) NOT NULL,
  body       TEXT,
  data       JSON,
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS executor_profiles (
  user_id        CHAR(36)      NOT NULL,
  availability   ENUM('available','busy','vacation') NOT NULL DEFAULT 'available',
  specialization VARCHAR(200),
  hourly_rate    DECIMAL(10,2),
  response_time  VARCHAR(50)   DEFAULT '< 24 часов',
  languages      JSON,
  skills         JSON,
  portfolio      JSON,
  socials        JSON,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_ep_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
