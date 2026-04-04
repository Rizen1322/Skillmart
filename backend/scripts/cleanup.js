require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query, pool } = require('../config/db');

// очищает мусор из бд: старые отменённые заказы, деактивированные юзеры, просроченные уведомления и тд
async function cleanup() {
  console.log(`[cleanup] запуск: ${new Date().toISOString()}`);
  const results = {};

  try {
    // 1. удаляем заказы со статусом cancelled старше 90 дней
    // сначала удаляем зависимые сообщения и логи
    const { rows: oldOrders } = await query(`
      SELECT id FROM orders
      WHERE status = 'cancelled'
      AND updated_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);
    if (oldOrders.length) {
      const ids = oldOrders.map(o => `'${o.id}'`).join(',');
      await query(`DELETE FROM messages        WHERE order_id IN (${ids})`);
      await query(`DELETE FROM order_status_log WHERE order_id IN (${ids})`);
      await query(`DELETE FROM transactions    WHERE order_id IN (${ids})`);
      const { rows: del } = await query(`DELETE FROM orders WHERE id IN (${ids})`);
      results.cancelled_orders = del.affectedRows;
    } else {
      results.cancelled_orders = 0;
    }

    // 2. удаляем деактивированные аккаунты старше 30 дней
    // сначала удаляем связанные данные чтобы не нарушить FK
    const { rows: deadUsers } = await query(`
      SELECT id FROM users
      WHERE is_active = 0
      AND updated_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    if (deadUsers.length) {
      const uids = deadUsers.map(u => `'${u.id}'`).join(',');
      await query(`DELETE FROM notifications   WHERE user_id IN (${uids})`);
      await query(`DELETE FROM balances        WHERE user_id IN (${uids})`);
      await query(`DELETE FROM executor_profiles WHERE user_id IN (${uids})`);
      // транзакции - обнуляем ссылку вместо удаления (для финансовой истории)
      await query(`UPDATE transactions SET user_id = NULL WHERE user_id IN (${uids})`);
      const { rows: delU } = await query(`DELETE FROM users WHERE id IN (${uids})`);
      results.deleted_users = delU.affectedRows;
    } else {
      results.deleted_users = 0;
    }

    // 3. удаляем уведомления старше 60 дней
    const { rows: delN } = await query(`
      DELETE FROM notifications
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 60 DAY)
    `);
    results.old_notifications = delN.affectedRows;

    // 4. удаляем прочитанные уведомления старше 7 дней
    const { rows: delNR } = await query(`
      DELETE FROM notifications
      WHERE is_read = 1
      AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    results.read_notifications = delNR.affectedRows;

    // 5. удаляем сообщения из завершённых/отменённых заказов старше 180 дней
    const { rows: delM } = await query(`
      DELETE m FROM messages m
      JOIN orders o ON o.id = m.order_id
      WHERE o.status IN ('completed', 'cancelled')
      AND m.created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)
    `);
    results.old_messages = delM.affectedRows;

    // 6. удаляем неактивные услуги от деактивированных юзеров
    const { rows: delS } = await query(`
      DELETE s FROM services s
      JOIN users u ON u.id = s.executor_id
      WHERE u.is_active = 0
      AND s.is_active = 0
    `);
    results.dead_services = delS.affectedRows;

    // 7. логируем в отдельную таблицу (если есть) или просто выводим
    console.log('[cleanup] готово:', JSON.stringify(results, null, 2));
    return results;
  } catch(err) {
    console.error('[cleanup] ошибка:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

cleanup().then(() => process.exit(0)).catch(() => process.exit(1));
