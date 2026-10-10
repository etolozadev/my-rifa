import cron from 'node-cron';
import { expireOrders } from '../services/orders';

/** Cada hora libera las reservas vencidas (además de la verificación al consultar la grilla). */
export function startExpireJob() {
  return cron.schedule('0 * * * *', async () => {
    try {
      const n = await expireOrders();
      if (n) console.log(`[expire] ${n} órdenes vencidas`);
    } catch (e) {
      console.error('[expire] error', e);
    }
  });
}
