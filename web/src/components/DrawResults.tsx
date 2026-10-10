import { useState } from 'react';
import { api, type PublicDraw } from '../lib/api';
import { shortDate } from '../lib/format';
import { verifyDraw, type VerifyResult } from '../lib/verify';
import { ShieldCheckIcon } from './icons';

/** Ganadores publicados, con la forma de comprobar cada sorteo. Los anulados se muestran aparte con su motivo. */
export function DrawResults({ slug, draws }: { slug: string; draws: PublicDraw[] }) {
  const valid = draws.filter((d) => !d.anuladoEn).sort((a, b) => a.premio.orden - b.premio.orden);
  const annulled = draws.filter((d) => d.anuladoEn);

  return (
    <section className="card" aria-labelledby="results-title">
      <h2 id="results-title">Resultados del sorteo</h2>
      {valid.length === 0 && <p className="muted small">Aún no hay premios sorteados.</p>}
      <ol className="results">
        {valid.map((d) => (
          <li key={d.id}>
            <div className="result-row">
              <span className="rank" aria-hidden="true">{d.premio.orden}°</span>
              <div>
                <b>{d.premio.nombre}</b>
                <p className="muted small">Sorteado el {shortDate(d.sorteadoEn)}</p>
              </div>
              <span className="winner">
                <span className="sr-only">Número ganador </span>
                <span aria-hidden="true">N° </span>
                {d.numero}
              </span>
            </div>
            <DrawProof slug={slug} draw={d} />
          </li>
        ))}
      </ol>
      {annulled.length > 0 && (
        <details>
          <summary className="small">Sorteos anulados ({annulled.length})</summary>
          <ul className="small stack" style={{ paddingLeft: 18 }}>
            {annulled.map((d) => (
              <li key={d.id}>
                {d.premio.nombre}: salió el N° {d.numero} el {shortDate(d.sorteadoEn)}, anulado el {shortDate(d.anuladoEn!)}. Motivo: {d.motivoAnulacion}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DrawProof({ slug, draw: d }: { slug: string; draw: PublicDraw }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  if (d.modo === 'manual') return <p className="muted small">Sorteo externo: {d.detalle}</p>;

  async function verify() {
    setBusy(true);
    try {
      const { numeros } = await api.drawParticipants(slug, d.id);
      setResult(await verifyDraw(d, numeros));
    } catch {
      setResult({ ok: false, reason: 'No se pudo descargar la lista de participantes' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="proof">
      <summary className="small">Cómo se sorteó</summary>
      <p className="small">
        Al azar entre los {d.participantes} números pagados, ordenados de menor a mayor. La posición ganadora es
        SHA-256 de la semilla, módulo {d.participantes}: la {(d.posicion ?? 0) + 1}ª de la lista.
      </p>
      <code className="url small">{d.semilla}</code>
      <div className="row">
        <button type="button" className="btn small" onClick={verify} disabled={busy}>
          <ShieldCheckIcon size={18} aria-hidden="true" />
          {busy ? 'Verificando…' : 'Verificar en mi navegador'}
        </button>
      </div>
      {result && (
        <p className={`banner ${result.ok ? 'ok' : 'error'}`} role="status">
          {result.ok
            ? `Verificado: el número ${d.numero} es el ${result.posicion + 1}° de ${d.participantes} participantes.`
            : `No coincide: ${result.reason}.`}
        </p>
      )}
    </details>
  );
}
