import { DataTypes, Model, ModelStatic } from 'sequelize';
import { sequelize } from '../db';

/**
 * Modelos Sequelize. La estructura real (restricciones, índices, CHECK) vive en
 * db/schema.sql; aquí solo se mapean las columnas. Las operaciones críticas
 * (reservar, vencer, confirmar) usan SQL condicional en services/.
 */
const define = (name: string, table: string, attrs: Record<string, any>): ModelStatic<Model<any, any>> =>
  sequelize.define(name, attrs, { tableName: table }) as ModelStatic<Model<any, any>>;

const id = { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true };
const int = (allowNull = false) => ({ type: DataTypes.INTEGER, allowNull });
const text = (allowNull = false) => ({ type: DataTypes.TEXT, allowNull });
const ts = (allowNull = true) => ({ type: DataTypes.DATE, allowNull, ...(allowNull ? {} : { defaultValue: DataTypes.NOW }) });

export const User = define('User', 'users', {
  id, nombre: text(), email: text(), passwordHash: text(), creadoEn: ts(false),
});

export const Raffle = define('Raffle', 'raffles', {
  id, slug: text(), nombre: text(), proposito: text(), objetivo: text(),
  metaMonto: int(), precioNumero: int(), cantidadTalonarios: int(),
  numerosPorTalonario: int(), maxNumerosPorOrden: int(), ttlReservaDias: int(),
  fechaSorteo: ts(false), estado: text(),
  bancoNombre: text(true), bancoTipoCuenta: text(true), bancoNumeroCuenta: text(true),
  bancoTitular: text(true), bancoRut: text(true), bancoEmailAviso: text(true),
  numeroAutorizacion: text(true), creadoEn: ts(false), actualizadoEn: ts(false),
});

export const RaffleMember = define('RaffleMember', 'raffle_members', {
  raffleId: { ...int(), primaryKey: true }, userId: { ...int(), primaryKey: true },
  rol: text(), creadoEn: ts(false),
});

export const Seller = define('Seller', 'sellers', {
  id, raffleId: int(), userId: int(), codigoEnlace: text(), activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
});

export const Booklet = define('Booklet', 'booklets', { id, raffleId: int(), numero: int() });

export const Ticket = define('Ticket', 'tickets', {
  id, raffleId: int(), bookletId: int(), numero: int(), estado: text(),
  orderId: int(true), sellerId: int(true),
});

export const Order = define('Order', 'orders', {
  id, raffleId: int(), token: text(), tipo: text(), canal: text(),
  compradorNombre: text(), compradorContacto: text(true), sellerId: int(true),
  contactId: int(true), contactoVendio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  numeros: { type: DataTypes.ARRAY(DataTypes.INTEGER), allowNull: false },
  monto: int(), estado: text(), creadaEn: ts(false), venceEn: ts(false),
  pagadaEn: ts(), confirmadaPor: int(true), shareLinkId: int(true),
});

export const PaymentProof = define('PaymentProof', 'payment_proofs', {
  id, orderId: int(), archivo: text(), nombreOriginal: text(), mime: text(),
  bytes: int(), subidoEn: ts(false),
});

export const Prize = define('Prize', 'prizes', {
  id, raffleId: int(), orden: int(), nombre: text(), descripcion: text(), imagenUrl: text(true),
});

export const ShareLink = define('ShareLink', 'share_links', {
  id, raffleId: int(), orderId: int(true), token: text(), cupo: int(), usados: int(), venceEn: ts(false),
  revocadoEn: ts(), compradorNombre: text(true), compradorContacto: text(true), sellerId: int(true),
  creadoPor: int(true), creadoEn: ts(false),
});

export const Invitation = define('Invitation', 'invitations', {
  id, raffleId: int(), token: text(), rol: text(), creadoPor: int(true), creadoEn: ts(false), venceEn: ts(false),
  usadaPor: int(true), usadaEn: ts(), revocadaEn: ts(),
});

export const Contact = define('Contact', 'contacts', {
  id, raffleId: int(), nombre: text(), telefono: text(), nota: text(), creadoPor: int(true), creadoEn: ts(false),
});

export const Draw = define('Draw', 'draws', {
  id, raffleId: int(), prizeId: int(), ticketId: int(), sorteadoPor: int(true), sorteadoEn: ts(false),
  anuladoEn: ts(), modo: text(), semilla: text(true), participantes: { type: DataTypes.ARRAY(DataTypes.INTEGER), allowNull: true },
  posicion: int(true), detalle: text(true), motivoAnulacion: text(true),
});

export const AuditLog = define('AuditLog', 'audit_log', {
  id, raffleId: int(true), userId: int(true), accion: text(), entidad: text(),
  entidadId: int(true), detalle: { type: DataTypes.JSONB, allowNull: false }, creadoEn: ts(false),
});

Raffle.hasMany(Booklet, { foreignKey: 'raffleId' });
Raffle.hasMany(Prize, { foreignKey: 'raffleId', as: 'premios' });
Raffle.hasMany(RaffleMember, { foreignKey: 'raffleId', as: 'miembros' });
RaffleMember.belongsTo(User, { foreignKey: 'userId' });
Seller.belongsTo(User, { foreignKey: 'userId' });
Order.hasMany(PaymentProof, { foreignKey: 'orderId', as: 'comprobantes' });
Order.hasMany(Ticket, { foreignKey: 'orderId', as: 'tickets' });
Ticket.belongsTo(Order, { foreignKey: 'orderId' });
