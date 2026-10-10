import { useState } from 'react';
import { api, type PublicDraw } from '../lib/api';
import { shortDate } from '../lib/format';
import { verifyDraw, type VerifyResult } from '../lib/verify';
import { DropIcon, ShieldCheckIcon } from './icons';

/**
 * Ganadores publicados por premio, con los números que se fueron al agua antes de cada uno y la forma de comprobar
 * cada sorteo. Los anulados se muestran aparte con su motivo.
 */
export function DrawResults({ slug, draws }: { slug: string; draws: PublicDraw[] }) {
  const valid = draws.filter((d) => !d.anuladoEn);
  const annulled = draws.filter((d) => d.anuladoEn);
  // Premios con algo sorteado (el ganador o al menos un número al agua), en orden
  const prizes = [...new Map(valid.map((d) => [d.premio.id, d.premio])).values()].sort((a, b) => a.orden - b.orden);

  return (
    <section className="card" aria-labelledby="results-title">
      <h2 id="results-title">Resultados del sorteo</h2>
      {prizes.length === 0 && <p className="muted small">Aún no hay premios sorteados.</p>}
      <ol className="results">
        {prizes.map((p) => {
          const winner = valid.find((d) => d.premio.id === p.id && d.tipo === 'premio');
          const water = valid.filter((d) => d.premio.id === p.id && d.tipo === 'agua');
          return (
            <li key={p.id}>
              <div className="result-row">
                <span className="rank" aria-hidden="true">{p.orden}°</span>
                <div>
                  <b>{p.nombre}</b>
                  <p className="muted small">{winner ? `Sorteado el ${shortDate(winner.sorteadoEn)}` : 'Por sortear'}</p>
                </div>
                {winner && (
                  <span className="winner">
                    <span className="sr-only">Número ganador </span>
                    <span aria-hidden="true">N° </span>
                    {winner.numero}
                  </span>
                )}
              </div>
              {winner && <DrawProof slug={slug} draw={winner} />}
              {water.length > 0 && (
                <div className="water">
                  <p className="water-title">
                    <DropIcon size={18} weight="duotone" aria-hidden="true" />
                    {water.length === 1 ? 'Se fue al agua' : `Se fueron al agua (${water.length})`}
                  </p>
                  <ul className="water-list">
                    {water.map((d) => (
                      <li key={d.id}>
                        <span className="chip neutral water-num">
                          <span className="sr-only">Número al agua </span>N° {d.numero}
                        </span>
                        <DrawProof slug={slug} draw={d} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {annulled.length > 0 && (
        <details>
          <summary className="small">Sorteos anulados ({annulled.length})</summary>
          <ul className="small stack" style={{ paddingLeft: 18 }}>
            {annulled.map((d) => (
              <li key={d.id}>
                {d.premio.nombre}: {d.tipo === 'agua' ? 'se fue al agua' : 'salió'} el N° {d.numero} el {shortDate(d.sorteadoEn)}, anulado el{' '}
                {shortDate(d.anuladoEn!)}. Motivo: {d.motivoAnulacion}
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
      <summary className="small">{d.tipo === 'agua' ? `Cómo salió el ${d.numero}` : 'Cómo se sorteó'}</summary>
      <p className="small">
        Al azar entre los {d.participantes} números pagados que quedaban en la tómbola, ordenados de menor a mayor. La
        posición que sale es SHA-256 de la semilla, módulo {d.participantes}: la {(d.posicion ?? 0) + 1}ª de la lista.
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
