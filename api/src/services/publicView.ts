import { QueryTypes } from 'sequelize';
import { sequelize } from '../db';
import { Prize } from '../models';
import { listDraws } from './draws';
import { raffleSummary } from './raffles';

export const bankOf = (r: any) => ({
  banco: r.bancoNombre,
  tipoCuenta: r.bancoTipoCuenta,
  numeroCuenta: r.bancoNumeroCuenta,
  titular: r.bancoTitular,
  rut: r.bancoRut,
  emailAviso: r.bancoEmailAviso,
});

/**
 * Lo que ve el público de una rifa: estado de cada número, SIN datos de compradores.
 * Los números asignados a un vendedor (su talonario físico) se muestran como no disponibles,
 * salvo para quien compra con el enlace de ese mismo vendedor (`viewerSellerId`).
 */
export async function publicRaffle(raffle: any, viewerSellerId: number | null = null) {
  const tickets = (await sequelize.query(
    `SELECT numero AS n, estado AS e, seller_id AS s FROM tickets WHERE raffle_id = :id ORDER BY numero`,
    { replacements: { id: raffle.id }, type: QueryTypes.SELECT },
  )) as { n: number; e: string; s: number | null }[];
  const numeros = tickets.map(({ n, e, s }) => ({ n, e: e === 'disponible' && s !== null && s !== viewerSellerId ? 'reservado' : e }));
  const premios = await Prize.findAll({ where: { raffleId: raffle.id }, order: [['orden', 'ASC']] });
  const resumen = await raffleSummary(raffle.id);
  return {
    slug: raffle.slug,
    nombre: raffle.nombre,
    proposito: raffle.proposito,
    objetivo: raffle.objetivo,
    metaMonto: raffle.metaMonto,
    precioNumero: raffle.precioNumero,
    precioTalonario: raffle.precioNumero * raffle.numerosPorTalonario,
    cantidadTalonarios: raffle.cantidadTalonarios,
    numerosPorTalonario: raffle.numerosPorTalonario,
    maxNumerosPorOrden: raffle.maxNumerosPorOrden,
    ttlReservaDias: raffle.ttlReservaDias,
    fechaSorteo: raffle.fechaSorteo,
    estado: raffle.estado,
    numeroAutorizacion: raffle.numeroAutorizacion,
    // Los datos bancarios solo se muestran mientras se puede comprar
    datosBancarios: raffle.estado === 'activa' ? bankOf(raffle) : null,
    premios: premios.map((p: any) => ({ orden: p.orden, nombre: p.nombre, descripcion: p.descripcion, imagenUrl: p.imagenUrl })),
    avance: {
      recaudado: resumen.recaudado,
      metaMonto: resumen.metaMonto,
      disponibles: numeros.filter((x) => x.e === 'disponible').length,
      reservados: resumen.reservados,
      pagados: resumen.pagados,
      talonariosDisponibles: resumen.talonariosDisponibles,
    },
    numeros,
    // Resultados del sorteo (incluidos los anulados, con su motivo), sin datos del ganador
    sorteos: await listDraws(raffle.id, false),
  };
}
