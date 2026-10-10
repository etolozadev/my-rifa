// Guarda en este navegador los enlaces de las reservas hechas, para poder volver a ellas.
// El almacenamiento puede no estar disponible (modo privado): todo va en try/catch.
export interface SavedOrder {
  token: string;
  slug: string;
  numeros: number[];
  monto: number;
  creadaEn: string;
}

const KEY = 'mis-rifas:ordenes';

export function loadOrders(slug: string): SavedOrder[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedOrder[];
    return all.filter((o) => o.slug === slug);
  } catch {
    return [];
  }
}

export function saveOrder(o: SavedOrder) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedOrder[];
    localStorage.setItem(KEY, JSON.stringify([o, ...all.filter((x) => x.token !== o.token)].slice(0, 30)));
  } catch {
    /* sin almacenamiento: no pasa nada, el comprador conserva el enlace de la orden */
  }
}
