import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, type AdminDraw, type AdminRaffle, type DrawInput, type Prize } from '../lib/admin';
import { plural, shortDate, ticketNumber } from '../lib/format';
import { drawRecipient, winnerMessage } from '../lib/messages';
import { DropIcon, SpeakerHighIcon, SpeakerSlashIcon } from '../components/icons';
import { CopyLink } from './CopyLink';
import { createDrawSound, launchConfetti, preloadDrawSounds, shortName, suspenseDelays, type DrawSound } from './drawFx';
import { DrawStage, type StageState } from './DrawStage';
import { NotifyButton } from './NotifyButton';
import { ContactLine, Phone } from './Phone';
import { useAdminLoad } from './session';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Preferencia de sonido del sorteo, recordada en este navegador (activada por defecto) */
const SOUND_KEY = 'mis-rifas:sonido-sorteo';
const readSoundPref = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
};

type DrawType = NonNullable<DrawInput['tipo']>;

/** Sin matchMedia (o con movimiento reducido) no hay animación */
const reducedMotion = () => !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function DrawTab({ raffle, onChanged }: { raffle: AdminRaffle; onChanged: () => void }) {
  const { data: draws, error, loading, reload } = useAdminLoad(() => adminApi.draws(raffle.id), 60_000);
  // Números pagados: la animación solo muestra números que de verdad participan
  const paid = useAdminLoad(() => adminApi.tickets(raffle.id, 'pagado'), 60_000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(readSoundPref);
  const toggleSound = () =>
    setSoundOn((on) => {
      try {
        localStorage.setItem(SOUND_KEY, on ? 'off' : 'on');
      } catch {
        /* sin almacenamiento: vale solo para esta sesión */
      }
      return !on;
    });
  // Las grabaciones del redoble se bajan al abrir la pestaña, para que suenen apenas se sortea
  useEffect(() => {
    if (soundOn && !reducedMotion()) void preloadDrawSounds();
  }, [soundOn]);
  const isOrganizer = raffle.rol === 'organizador';
  const prizes = [...raffle.premios].sort((a, b) => a.orden - b.orden);
  const valid = (draws ?? []).filter((d) => !d.anuladoEn);
  const annulled = (draws ?? []).filter((d) => d.anuladoEn);
  const participants = raffle.resumen.pagados - valid.length;
  const won = new Set(valid.map((d) => d.numero));
  const pool = (paid.data ?? []).map((t) => t.numero).filter((n) => !won.has(n));

  const refresh = async () => {
    await Promise.all([reload(), paid.reload()]);
    onChanged();
  };

  async function closeSale() {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.updateRaffle(raffle.id, { estado: 'cerrada' });
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? describeError(err) : 'No se pudo cerrar la venta.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Cargando sorteo…</p>;
  if (!draws) return <div className="banner error" role="alert">{error?.message ?? 'No se pudo cargar el sorteo.'}</div>;

  return (
    <div className="stack gap16">
      <section className="card" aria-labelledby="draw-title">
        <h2 id="draw-title">Sorteo</h2>
        {raffle.estado === 'borrador' && <p className="muted small">Activa la rifa y vende números antes de sortear.</p>}
        {raffle.estado === 'activa' && (
          <>
            <p className="muted small">Para sortear, primero cierra la venta: así nadie reserva mientras sorteas.</p>
            {isOrganizer && <button className="btn" disabled={busy} onClick={closeSale}>Cerrar venta</button>}
          </>
        )}
        {raffle.estado === 'cerrada' && (
          <>
            <p className="small">
              Participan <b>{plural(participants, 'número pagado', 'números pagados')}</b>. Un número que ya ganó o que se fue al agua no vuelve a participar.
              {raffle.resumen.reservados > 0 &&
                ` Hay ${plural(raffle.resumen.reservados, 'número reservado', 'números reservados')} sin pagar: ${raffle.resumen.reservados === 1 ? 'no participa' : 'no participan'}.`}
            </p>
            {isOrganizer && (
              <div className="row">
                <button type="button" className="btn small" onClick={toggleSound} aria-pressed={soundOn}>
                  {soundOn ? <SpeakerHighIcon size={18} aria-hidden="true" /> : <SpeakerSlashIcon size={18} aria-hidden="true" />}
                  {soundOn ? 'Sonido del sorteo activado' : 'Sonido del sorteo desactivado'}
                </button>
                <span className="muted small">Ideal para compartir la pantalla en vivo.</span>
              </div>
            )}
          </>
        )}
        {raffle.estado === 'sorteada' && (
          <>
            <p className="small">Todos los premios fueron sorteados. Los resultados quedaron publicados en la página de la rifa, con la forma de verificarlos.</p>
            <CopyLink url={`${window.location.origin}/r/${raffle.slug}`} label="Copiar enlace de resultados" />
          </>
        )}
        {msg && <div className="banner error" role="alert">{msg}</div>}
      </section>

      {prizes.length === 0 && <p className="banner">Agrega premios en Configuración para poder sortearlos.</p>}
      <ul className="list">
        {prizes.map((p) => (
          <li key={p.id}>
            <PrizeDraw
              raffle={raffle}
              prize={p}
              draw={valid.find((d) => d.premio.id === p.id && d.tipo === 'premio') ?? null}
              water={valid.filter((d) => d.premio.id === p.id && d.tipo === 'agua')}
              pool={pool}
              canDraw={isOrganizer && raffle.estado === 'cerrada'}
              soundOn={soundOn}
              onToggleSound={toggleSound}
              onChanged={refresh}
            />
          </li>
        ))}
      </ul>

      {annulled.length > 0 && (
        <section className="card" aria-labelledby="annulled-title">
          <h2 id="annulled-title">Sorteos anulados</h2>
          <p className="muted small">Quedan publicados con su motivo, para que todo el proceso sea transparente.</p>
          <ul className="stack small" style={{ margin: 0, paddingLeft: 18 }}>
            {annulled.map((d) => (
              <li key={d.id}>
                {d.premio.nombre}: N° {d.numero}{d.tipo === 'agua' && ' al agua'} ({shortDate(d.sorteadoEn)}), anulado el {shortDate(d.anuladoEn!)}. Motivo: {d.motivoAnulacion}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface PrizeDrawProps {
  raffle: AdminRaffle;
  prize: Prize;
  draw: AdminDraw | null;
  /** Números que se fueron al agua antes de este premio */
  water: AdminDraw[];
  /** Números que participan (para la animación) */
  pool: number[];
  canDraw: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onChanged: () => Promise<void>;
}

function PrizeDraw({ raffle, prize, draw, water, pool, canDraw, soundOn, onToggleSound, onChanged }: PrizeDrawProps) {
  const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;
  const [manual, setManual] = useState(false);
  const [manualTipo, setManualTipo] = useState<DrawType>('premio');
  const [numero, setNumero] = useState('');
  const [detalle, setDetalle] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<StageState | null>(null);
  // Aviso de reservas sin pagar, con el tipo de sorteo que lo provocó (para repetirlo confirmando)
  const [pending, setPending] = useState<{ message: string; tipo: DrawType } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Efectos en curso: se cortan al cerrar el escenario, al saltar o si el componente desaparece
  const soundRef = useRef<DrawSound | null>(null);
  const confettiRef = useRef<(() => void) | null>(null);
  const skipRef = useRef(false);

  useEffect(() => soundRef.current?.setMuted(!soundOn), [soundOn]);
  useEffect(
    () => () => {
      soundRef.current?.stop();
      confettiRef.current?.();
    },
    [],
  );

  /** Un número del bombo distinto al anterior (y, hasta el final, distinto del ganador) */
  const pick = (prev: number | undefined, avoid?: number) => {
    const options = pool.filter((n) => n !== prev && n !== avoid);
    const from = options.length ? options : pool;
    return from[Math.floor(Math.random() * from.length)];
  };

  async function run(tipo: DrawType, confirmarPendientes = false) {
    const body: DrawInput = manual
      ? { premioId: prize.id, tipo, modo: 'manual', numero: Number(numero), detalle: detalle.trim(), confirmarPendientes }
      : { premioId: prize.id, tipo, modo: 'aleatorio', confirmarPendientes };
    const agua = tipo === 'agua';
    setBusy(true);
    setError(null);
    const motion = !reducedMotion();
    // Suspenso solo en el sorteo al azar; el resultado externo se celebra directo
    const suspense = motion && !manual && pool.length > 1;
    // El audio se prepara dentro del clic (los navegadores lo exigen); suena solo si hay escenario
    const sound = motion ? createDrawSound(!soundOn) : null;
    soundRef.current = sound;
    skipRef.current = false;

    let current: number | undefined;
    let rollTimer: ReturnType<typeof setInterval> | undefined;
    let shown = false;
    // Giro rápido mientras responde el servidor. Se muestra recién a los 250 ms: si la API responde con
    // un aviso (reservas pendientes), el escenario no alcanza a aparecer.
    const show = () => {
      if (shown) return;
      shown = true;
      current = pick(undefined);
      setStage({ phase: 'rolling', numero: current, tipo });
      sound?.start();
      rollTimer = setInterval(() => {
        current = pick(current);
        setStage({ phase: 'rolling', numero: current, tipo });
        sound?.tick(0);
      }, 70);
    };
    const showTimer = suspense ? setTimeout(show, 250) : undefined;
    const started = Date.now();

    try {
      const d = await adminApi.drawPrize(raffle.id, body);
      clearTimeout(showTimer);
      if (suspense) {
        show();
        await sleep(Math.max(0, 1500 - (Date.now() - started)));
        clearInterval(rollTimer);
        // La tómbola frena hasta caer en el ganador
        const delays = suspenseDelays();
        for (let i = 0; i < delays.length && !skipRef.current; i++) {
          const last = i === delays.length - 1;
          current = last ? d.numero : pick(current, d.numero);
          setStage({ phase: 'rolling', numero: current, tipo });
          sound?.tick(i / (delays.length - 1));
          await sleep(delays[i]);
        }
      }
      if (motion) {
        setStage({ phase: 'reveal', numero: d.numero, tipo, ganador: shortName(d.compradorNombre) });
        sound?.reveal(tipo);
        // Se celebra al ganador; el número al agua solo se hunde
        if (!agua) {
          confettiRef.current?.();
          confettiRef.current = launchConfetti();
        }
      }
      setPending(null);
      setManual(false);
      await onChanged();
    } catch (err) {
      clearTimeout(showTimer);
      setStage(null);
      sound?.stop();
      if (err instanceof ApiError && err.code === 'pending_orders') setPending({ message: err.message, tipo });
      else setError(err instanceof ApiError ? describeError(err) : 'No se pudo sortear.');
    } finally {
      clearInterval(rollTimer);
      setBusy(false);
    }
  }

  function closeStage() {
    setStage(null);
    soundRef.current?.stop();
    soundRef.current = null;
    confettiRef.current?.();
    confettiRef.current = null;
  }

  function submitManual(e: FormEvent) {
    e.preventDefault();
    const n = Number(numero);
    if (!Number.isInteger(n) || n < 1 || n > total) return setError(`El número va del 1 al ${total}`);
    if (detalle.trim().length < 3) return setError('Indica de dónde salió el número');
    run(manualTipo);
  }

  return (
    <article className="card" aria-labelledby={`p-${prize.id}`}>
      <div className="row between">
        <h3 id={`p-${prize.id}`}>
          {prize.orden}° premio: {prize.nombre}
        </h3>
        {draw ? <span className="chip ok">Sorteado</span> : <span className="chip neutral">Pendiente</span>}
      </div>

      {stage && (
        <DrawStage
          prize={prize}
          total={total}
          stage={stage}
          soundOn={soundOn}
          onToggleSound={onToggleSound}
          onSkip={() => {
            skipRef.current = true;
          }}
          onClose={closeStage}
        />
      )}

      {water.length > 0 && <WaterList draws={water} total={total} canAnnul={raffle.rol === 'organizador'} onChanged={onChanged} />}

      {draw ? (
        <Winner raffle={raffle} draw={draw} canAnnul={raffle.rol === 'organizador'} onChanged={onChanged} />
      ) : (
        canDraw &&
        !stage && (
          <>
            {!manual ? (
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={() => run('premio')}>Sortear al azar</button>
                <button className="btn" disabled={busy} onClick={() => run('agua')}>
                  <DropIcon size={18} aria-hidden="true" />
                  Tirar un número al agua
                </button>
                <button className="btn" disabled={busy} onClick={() => setManual(true)}>Registrar resultado externo</button>
              </div>
            ) : (
              <form className="subform" onSubmit={submitManual} noValidate aria-label={`Resultado externo de ${prize.nombre}`}>
                <fieldset className="choice">
                  <legend>Este número</legend>
                  <div className="row">
                    <label className="check">
                      <input type="radio" name={`t-${prize.id}`} checked={manualTipo === 'premio'} onChange={() => setManualTipo('premio')} />
                      Ganó el premio
                    </label>
                    <label className="check">
                      <input type="radio" name={`t-${prize.id}`} checked={manualTipo === 'agua'} onChange={() => setManualTipo('agua')} />
                      Se fue al agua
                    </label>
                  </div>
                </fieldset>
                <div className="grid2">
                  <div className="field">
                    <label htmlFor={`n-${prize.id}`}>{manualTipo === 'agua' ? 'Número al agua' : 'Número ganador'}</label>
                    <input id={`n-${prize.id}`} type="number" min={1} max={total} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`d-${prize.id}`}>De dónde salió</label>
                    <input id={`d-${prize.id}`} maxLength={300} placeholder="Ej: Lotería del 12/11, 3 últimas cifras" value={detalle} onChange={(e) => setDetalle(e.target.value)} />
                  </div>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn small" disabled={busy} onClick={() => setManual(false)}>Cancelar</button>
                  <button type="submit" className="btn small primary" disabled={busy}>
                    {manualTipo === 'agua' ? 'Registrar número al agua' : 'Registrar ganador'}
                  </button>
                </div>
              </form>
            )}
          </>
        )
      )}

      {pending && (
        <div className="banner" role="alert">
          {pending.message} ¿Sortear igual?
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small primary" disabled={busy} onClick={() => run(pending.tipo, true)}>Sortear igual</button>
            <button className="btn small" disabled={busy} onClick={() => setPending(null)}>Revisar primero</button>
          </div>
        </div>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}
    </article>
  );
}

/** Cómo salió un número: al azar (entre cuántos) o de un sorteo externo */
const drawOrigin = (d: AdminDraw) => (d.modo === 'aleatorio' ? `Al azar entre ${d.participantes} números` : `Sorteo externo: ${d.detalle}`);

/** Números que se fueron al agua antes de un premio. Anular uno lo devuelve a la tómbola. */
function WaterList({ draws, total, canAnnul, onChanged }: { draws: AdminDraw[]; total: number; canAnnul: boolean; onChanged: () => Promise<void> }) {
  const [annulling, setAnnulling] = useState<number | null>(null);
  return (
    <div className="water">
      <h4 className="water-title">
        <DropIcon size={18} weight="duotone" aria-hidden="true" />
        {draws.length === 1 ? 'Se fue al agua' : `Se fueron al agua (${draws.length})`}
      </h4>
      <ul className="water-list">
        {draws.map((d) => (
          <li key={d.id}>
            <div className="water-row">
              <span className="chip neutral">
                <span className="sr-only">Número al agua </span>
                {ticketNumber(d.numero, total)}
              </span>
              <span className="small">
                {d.compradorNombre ?? 'Sin comprador'}
                <span className="muted"> · {drawOrigin(d)} · {shortDate(d.sorteadoEn)}</span>
              </span>
              {canAnnul && annulling !== d.id && (
                <button className="btn small" onClick={() => setAnnulling(d.id)} aria-label={`Anular el ${d.numero} al agua`}>
                  Anular
                </button>
              )}
            </div>
            {annulling === d.id && (
              <AnnulForm
                draw={d}
                label="Devolver a la tómbola"
                placeholder="Ej: se anotó un número equivocado"
                onCancel={() => setAnnulling(null)}
                onDone={onChanged}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Anula un sorteo con un motivo, que queda publicado junto al resultado */
function AnnulForm({ draw: d, label, placeholder, onCancel, onDone }: { draw: AdminDraw; label: string; placeholder: string; onCancel: () => void; onDone: () => Promise<void> }) {
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function annul(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 5) return setError('Explica el motivo (queda publicado)');
    setBusy(true);
    setError(null);
    try {
      await adminApi.annulDraw(d.id, motivo.trim());
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err) : 'No se pudo anular.');
      setBusy(false);
    }
  }

  return (
    <form className="subform" onSubmit={annul} noValidate aria-label={d.tipo === 'agua' ? `Anular el ${d.numero} al agua` : 'Anular sorteo'}>
      <div className="field">
        <label htmlFor={`m-${d.id}`}>Motivo (se publica junto al resultado)</label>
        <input id={`m-${d.id}`} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={placeholder} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn small" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn small danger" disabled={busy}>{label}</button>
      </div>
      {error && <div className="banner error" role="alert">{error}</div>}
    </form>
  );
}

function Winner({ raffle, draw: d, canAnnul, onChanged }: { raffle: AdminRaffle; draw: AdminDraw; canAnnul: boolean; onChanged: () => Promise<void> }) {
  const [annulling, setAnnulling] = useState(false);
  const to = drawRecipient(d);

  return (
    <div className="stack">
      <div className="result-row">
        <span className="winner big">
          <span className="sr-only">Número ganador </span>
          <span aria-hidden="true">N° </span>
          {d.numero}
        </span>
        <div>
          <b>{d.compradorNombre ?? 'Sin comprador'}</b>
          {d.compradorContacto && (
            <span className="small">
              {' '}· <Phone value={d.compradorContacto} />
            </span>
          )}
          {d.contactoNombre && d.contactoTelefono && (
            <p className="small">
              <ContactLine nombre={d.contactoNombre} telefono={d.contactoTelefono} />
            </p>
          )}
          <p className="muted small">
            {drawOrigin(d)} · {shortDate(d.sorteadoEn)}
            {d.ordenId && ` · orden #${d.ordenId}`}
            {d.vendedorNombre && ` · vendedor: ${d.vendedorNombre}`}
          </p>
        </div>
      </div>
      <div className="row">
        {to && (
          <NotifyButton
            contact={to.telefono}
            text={winnerMessage(d, raffle)}
            label={to.esContacto ? `Avisar a ${to.nombre.split(' ')[0]} (contacto)` : 'Avisar al ganador'}
          />
        )}
        {canAnnul && !annulling && <button className="btn small danger" onClick={() => setAnnulling(true)}>Anular sorteo</button>}
      </div>
      {annulling && (
        <AnnulForm
          draw={d}
          label="Anular y permitir repetir"
          placeholder="Ej: el ganador no respondió en 7 días"
          onCancel={() => setAnnulling(false)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}
