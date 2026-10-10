import nodemailer from 'nodemailer';
import { QueryTypes } from 'sequelize';
import { config } from '../config';
import { sequelize } from '../db';

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

/** En pruebas los correos quedan aquí en vez de enviarse */
export const outbox: Mail[] = [];

const transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL, { from: config.MAIL_FROM }) : null;

/** Correos del organizador y los editores de una rifa (quienes confirman pagos) */
async function teamEmails(raffleId: number): Promise<string[]> {
  const rows = (await sequelize.query(
    `SELECT u.email FROM raffle_members m JOIN users u ON u.id = m.user_id
     WHERE m.raffle_id = :raffleId AND m.rol IN ('organizador', 'editor') ORDER BY m.creado_en`,
    { replacements: { raffleId }, type: QueryTypes.SELECT },
  )) as { email: string }[];
  return rows.map((r) => r.email);
}

/**
 * Aviso al equipo de una rifa. No bloquea ni falla la petición que lo origina: si el correo
 * no sale, se registra en el log y listo (el panel sigue mostrando todo).
 */
export function notifyTeam(raffleId: number, subject: string, lines: string[]): Promise<void> {
  const send = async () => {
    const to = await teamEmails(raffleId);
    if (!to.length) return;
    const mail = { to, subject, text: `${lines.join('\n')}\n\n— mis-rifas` };
    if (config.NODE_ENV === 'test') {
      outbox.push(mail);
      return;
    }
    if (!transport) return;
    await transport.sendMail(mail);
  };
  return send().catch((e) => console.error('[aviso] no se pudo enviar el correo:', e?.message ?? e));
}

const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
export const money = (n: number) => clp.format(n);

/** Enlace absoluto al panel (el front vive en WEB_ORIGIN) */
export const panelUrl = (path: string) => `${config.WEB_ORIGIN.replace(/\/$/, '')}/admin${path}`;
