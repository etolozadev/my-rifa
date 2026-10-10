import type { PublicRaffle } from '../lib/api';
import { money } from '../lib/format';
import { bookletIsFree, bookletNumbers } from '../lib/selection';

interface Props {
  raffle: Pick<PublicRaffle, 'numerosPorTalonario' | 'cantidadTalonarios' | 'precioTalonario' | 'numeros'>;
  selection: Set<number>;
  onToggle: (n: number) => void;
  onToggleBooklet: (k: number) => void;
  /** La venta está cerrada: se ve la grilla pero no se puede elegir */
  readOnly?: boolean;
}

const LABEL = { disponible: 'disponible', reservado: 'reservado', pagado: 'vendido' } as const;

export function NumberGrid({ raffle, selection, onToggle, onToggleBooklet, readOnly }: Props) {
  const stateOf = new Map(raffle.numeros.map((x) => [x.n, x.e]));
  const per = raffle.numerosPorTalonario;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {Array.from({ length: raffle.cantidadTalonarios }, (_, i) => i + 1).map((k) => {
        const nums = bookletNumbers(k, per);
        const free = bookletIsFree(k, raffle);
        const allSelected = nums.every((n) => selection.has(n));
        const anyFree = nums.some((n) => stateOf.get(n) === 'disponible');
        return (
          <section key={k} className="card booklet" aria-label={`Talonario ${k}`}>
            <header>
              <div>
                <h3>Talonario {k}</h3>
                <span className="muted small">
                  Números {nums[0]} al {nums[nums.length - 1]}
                </span>
              </div>
              {!readOnly && !anyFree && !allSelected && <span className="chip neutral">Agotado</span>}
              {!readOnly && (anyFree || allSelected) && (
                <button
                  type="button"
                  className="btn small"
                  disabled={!free && !allSelected}
                  aria-pressed={allSelected}
                  onClick={() => onToggleBooklet(k)}
                  title={free || allSelected ? undefined : 'Este talonario ya tiene números tomados'}
                >
                  {allSelected ? 'Quitar talonario' : `Talonario completo · ${money(raffle.precioTalonario)}`}
                </button>
              )}
            </header>
            <div className="numbers">
              {nums.map((n) => {
                const e = stateOf.get(n) ?? 'pagado';
                const selected = selection.has(n);
                const canPick = e === 'disponible' && !readOnly;
                const cls = ['num', selected ? 'selected' : e !== 'disponible' ? e : ''].join(' ').trim();
                return (
                  <button
                    key={n}
                    type="button"
                    className={cls}
                    disabled={!canPick}
                    aria-pressed={canPick ? selected : undefined}
                    aria-label={`Número ${n}, ${selected ? 'seleccionado' : LABEL[e]}`}
                    onClick={() => onToggle(n)}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <div className="legend" aria-label="Leyenda">
        <span><i /> Disponible</span>
        <span><i className="s" /> Tu selección</span>
        <span><i className="r" /> Reservado (pendiente de pago)</span>
        <span><i className="p" /> Vendido</span>
      </div>
    </div>
  );
}
