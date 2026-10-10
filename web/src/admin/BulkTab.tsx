import { ChangeEvent, useMemo, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, parseBulk, type AdminRaffle, type BulkResult } from '../lib/admin';
import { money, plural } from '../lib/format';
import { useAdminLoad } from './session';

const EXAMPLE = '1-5; Juan Pérez; +56 9 1234 5678\n12, 14; María Soto; 987654321; no';

/** Carga rápida de ventas físicas: una por línea, pegadas o importadas desde un CSV (Excel). */
export function BulkTab({ raffle, onChanged }: { raffle: AdminRaffle; onChanged: () => void }) {
  const isSeller = raffle.rol === 'vendedor';
  const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;
  const [text, setText] = useState('');
  const [pagada, setPagada] = useState(true);
  const [canal, setCanal] = useState<'fisica' | 'manual'>('fisica');
  const [sellerId, setSellerId] = useState('');
  const [busy, setBusy] = useState(false);
  // Se guarda con los números de línea del texto enviado (el cuadro cambia después de cargar)
  const [result, setResult] = useState<{ creadas: number; fallas: { linea: number; texto: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Solo el equipo elige a quién atribuir el lote; el vendedor carga a su nombre
  const sellers = useAdminLoad(() => (isSeller ? Promise.resolve([]) : adminApi.sellers(raffle.id)), 300_000).data ?? [];

  const rows = useMemo(() => parseBulk(text, total, pagada), [text, total, pagada]);
  const valid = rows.filter((r) => r.venta);
  const invalid = rows.filter((r) => r.error);
  const count = valid.reduce((n, r) => n + r.venta!.numeros.length, 0);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) return setError('El archivo es demasiado grande (máximo 1 MB).');
    setText((await file.text()).trim());
    setResult(null);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const vendedorId = sellerId ? Number(sellerId) : undefined;
      const r: BulkResult = await adminApi.bulkSales(raffle.id, valid.map((x) => ({ ...x.venta!, ...(vendedorId ? { vendedorId } : {}) })), canal);
      const failed = r.resultados.filter((x) => !x.ok);
      const lines = text.split(/\r?\n/);
      const lineOf = (fila: number) => lines[valid[fila - 1].linea - 1].trim();
      setResult({
        creadas: r.creadas,
        fallas: failed.map((x) => ({
          linea: x.fila,
          texto: `"${lineOf(x.fila)}": ${x.error}${x.noDisponibles?.length ? ` (${x.noDisponibles.join(', ')})` : ''}`,
        })),
      });
      // Quedan en el cuadro solo las líneas que fallaron, para corregirlas y reintentar
      setText(failed.map((x) => lineOf(x.fila)).join('\n'));
      if (r.creadas) onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err) : 'No se pudo cargar el lote.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap16">
      <section className="card" aria-labelledby="bulk-title">
        <h2 id="bulk-title">Carga rápida de ventas</h2>
        <p className="muted small">
          Una venta por línea: <b>números; nombre; contacto</b>. Los números aceptan rangos (<code>10-15</code>). Una 4ª columna opcional
          (<code>sí</code>/<code>no</code>) indica si esa venta ya está pagada. También puedes importar un CSV de Excel con esas columnas.
        </p>
        <div className="field">
          <label htmlFor="bulk-text">Ventas</label>
          <textarea id="bulk-text" rows={8} placeholder={EXAMPLE} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} spellCheck={false} />
        </div>
        <div className="row">
          <label className="btn small">
            Importar CSV
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={onFile} />
          </label>
          {text && <button type="button" className="btn small" onClick={() => { setText(''); setResult(null); }}>Limpiar</button>}
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="bulk-canal">Canal</label>
            <select id="bulk-canal" value={canal} onChange={(e) => setCanal(e.target.value as 'fisica' | 'manual')}>
              <option value="fisica">Talonario físico</option>
              <option value="manual">Otro (transferencia o efectivo directo)</option>
            </select>
          </div>
          {!isSeller && sellers.some((s) => s.activo) && (
            <div className="field">
              <label htmlFor="bulk-seller">Atribuir a</label>
              <select id="bulk-seller" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                <option value="">Sin vendedor</option>
                {sellers.filter((s) => s.activo).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={pagada} onChange={(e) => setPagada(e.target.checked)} />
          Marcar como pagadas (salvo las que digan "no")
        </label>
        {isSeller && <p className="muted small">Las ventas quedan a tu nombre. Solo puedes usar números de tu talonario o libres.</p>}
      </section>

      {rows.length > 0 && (
        <section className="card" aria-labelledby="preview-title">
          <h2 id="preview-title">Vista previa</h2>
          <p className="small">
            {plural(valid.length, 'venta', 'ventas')} · {plural(count, 'número', 'números')} · {money(count * raffle.precioNumero)}
            {invalid.length > 0 && <b className="err"> · {plural(invalid.length, 'línea con error', 'líneas con error')}</b>}
          </p>
          {invalid.length > 0 && (
            <ul className="errors" role="alert">
              {invalid.map((r) => <li key={r.linea}>Línea {r.linea}: {r.error}</li>)}
            </ul>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Línea</th><th>Números</th><th>Comprador</th><th>Contacto</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {valid.map(({ linea, venta }) => (
                  <tr key={linea}>
                    <td>{linea}</td>
                    <td>{venta!.numeros.join(', ')}</td>
                    <td>{venta!.compradorNombre}</td>
                    <td>{venta!.compradorContacto}</td>
                    <td>{venta!.pagada ? 'Pagada' : 'Pendiente'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn primary" disabled={busy || !valid.length || invalid.length > 0} onClick={submit}>
            {busy ? 'Cargando…' : `Cargar ${plural(valid.length, 'venta', 'ventas')}`}
          </button>
          {invalid.length > 0 && <p className="muted small">Corrige las líneas con error para poder cargar.</p>}
        </section>
      )}

      {error && <div className="banner error" role="alert">{error}</div>}
      {result && (
        <div className={`banner ${result.fallas.length ? 'error' : 'ok'}`} role="status">
          {plural(result.creadas, 'venta cargada', 'ventas cargadas')}.
          {result.fallas.length > 0 && (
            <>
              {' '}{plural(result.fallas.length, 'no se pudo cargar', 'no se pudieron cargar')} (quedaron en el cuadro para corregirlas):
              <ul className="errors">
                {result.fallas.map((f) => <li key={f.linea}>{f.texto}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
