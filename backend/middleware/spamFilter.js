// фильтр спама в текстовых полях
// блокирует очевидно мусорный контент

// стоп-слова в названиях/описаниях
const SPAM_PATTERNS = [
  /(.)\1{6,}/i,                        // повторение символа 7+ раз: ааааааа
  /https?:\/\/[^\s]{3,}/gi,            // ссылки в названии услуги
  /\b(casino|poker|xxx|porn|viagra|crypto|nft|airdrop|pump)\b/i,
  /[^\x00-\x7F]{50,}/,                  // 50+ подряд не-ASCII (бессмысленный unicode)
];

// максимальные длины полей
const LIMITS = {
  title:          200,
  description:   5000,
  requirements:  2000,
  message:       2000,
  bio:            500,
  specialization: 80,
  comment:       1000,
};

function checkSpam(text, field) {
  if (!text || typeof text !== 'string') return null;
  const limit = LIMITS[field];
  if (limit && text.length > limit) {
    return `Поле "${field}" слишком длинное (максимум ${limit} символов)`;
  }
  for (const pat of SPAM_PATTERNS) {
    if (pat.test(text)) return 'Текст содержит недопустимое содержимое';
  }
  return null;
}

// middleware для проверки тела запроса
const spamCheck = (fields) => (req, res, next) => {
  for (const field of fields) {
    const val = req.body?.[field];
    if (!val) continue;
    const err = checkSpam(String(val), field);
    if (err) return res.status(400).json({ error: err });
  }
  next();
};

module.exports = { spamCheck, checkSpam, LIMITS };
