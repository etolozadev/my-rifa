import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { describeError, toLocalInput, type RaffleInput } from '../lib/admin';
import { money } from '../lib/format';
import { PURPOSE } from './labels';

type Values = Record<keyof RaffleInput, string>;

const NUMERIC = ['metaMonto', 'precioNumero', 'cantidadTalonarios', 'numerosPorTalonario', 'maxNumerosPorOrden', 'ttlReservaDias'] as const;
const OPTIONAL = ['numeroAutorizacion', 'bancoNombre', 'bancoTipoCuenta', 'bancoNumeroCuenta', 'bancoTitular', 'bancoRut', 'bancoEmailAviso'] as const;

export const EMPTY_RAFFLE: Values = {
  nombre: '',
  proposito: 'otro',
  objetivo: '',
  metaMonto: '',
  precioNumero: '1000',
  cantidadTalonarios: '10',
  numerosPorTalonario: '10',
  maxNumerosPorOrden: '20',
  ttlReservaDias: '7',
  fechaSorteo: '',
  numeroAutorizacion: '',
  bancoNombre: '',
  bancoTipoCuenta: '',
  bancoNumeroCuenta: '',
  bancoTitular: '',
  bancoRut: '',
  bancoEmailAviso: '',
};

export function toValues(r: RaffleInput): Values {
  const v = { ...EMPTY_RAFFLE };
  for (const k of Object.keys(EMPTY_RAFFLE) as (keyof RaffleInput)[]) {
    const x = r[k];
    v[k] = x === null || x === undefined ? '' : String(x);
  }
  v.fechaSorteo = r.fechaSorteo ? toLocalInput(r.fechaSorteo) : '';
  return v;
}

function validate(v: Values): Partial<Record<keyof RaffleInput, string>> {
  const e: Partial<Record<keyof RaffleInput, string>> = {};
  if (v.nombre.trim().length < 3) e.nombre = 'Mínimo 3 caracteres';
  const int = (k: keyof RaffleInput, min: number, max = Infinity) => {
    const n = Number(v[k]);
    if (v[k].trim() === '' || !Number.isInteger(n) || n < min || n > max) e[k] = max === Infinity ? `Entero desde ${min}` : `Entre ${min} y ${max}`;
  };
  int('precioNumero', 1);
  int('cantidadTalonarios', 1, 500);
  int('numerosPorTalonario', 1, 200);
  int('maxNumerosPorOrden', 1, 200);
  int('ttlReservaDias', 1, 60);
  if (v.metaMonto.trim() !== '') int('metaMonto', 0);
  if (!v.fechaSorteo || Number.isNaN(new Date(v.fechaSorteo).getTime())) e.fechaSorteo = 'Elige fecha y hora';
  if (v.bancoEmailAviso.trim() && !/^\S+@\S+\.\S+$/.test(v.bancoEmailAviso.trim())) e.bancoEmailAviso = 'Correo inválido';
  return e;
}

function toInput(v: Values): RaffleInput {
  const out: any = { nombre: v.nombre.trim(), proposito: v.proposito, objetivo: v.objetivo.trim() };
  for (const k of NUMERIC) out[k] = k === 'metaMonto' && v[k].trim() === '' ? 0 : Number(v[k]);
  for (const k of OPTIONAL) out[k] = v[k].trim() || null;
  out.fechaSorteo = new Date(v.fechaSorteo).toISOString();
  return out;
}

interface Props {
  initial: Values;
  /** Precio y talonarios solo se cambian en borrador */
  structureLocked?: boolean;
  submitLabel: string;
  onSubmit: (input: RaffleInput) => Promise<void>;
}

export function RaffleForm({ initial, structureLocked = false, submitLabel, onSubmit }: Props) {
  const [v, setV] = useState<Values>(initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const errors = validate(v);

  const set = (k: keyof RaffleInput) => (e: { target: { value: string } }) => {
    setV((prev) => ({ ...prev, [k]: e.target.value }));
    setMsg(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) {
      setMsg({ kind: 'error', text: 'Revisa los campos marcados.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await onSubmit(toInput(v));
      setMsg({ kind: 'ok', text: 'Cambios guardados.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? describeError(err) : 'No se pudo guardar.' });
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof RaffleInput, label: string, props: Record<string, unknown> = {}, hint?: string) => {
    const err = touched ? errors[k] : undefined;
    return (
      <div className="field">
        <label htmlFor={`f-${k}`}>{label}</label>
        <input id={`f-${k}`} value={v[k]} onChange={set(k)} aria-invalid={!!err} {...props} />
        {hint && <span className="hint">{hint}</span>}
        {err && <span className="err">{err}</span>}
      </div>
    );
  };

  const total = Number(v.cantidadTalonarios) * Number(v.numerosPorTalonario);
  const potential = total * Number(v.precioNumero);
  const num = { type: 'number', inputMode: 'numeric', min: 0 };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <fieldset className="card">
        <legend>General</legend>
        {field('nombre', 'Nombre de la rifa', { maxLength: 120 })}
        <div className="field">
          <label htmlFor="f-proposito">Propósito</label>
          <select id="f-proposito" value={v.proposito} onChange={set('proposito')}>
            {Object.entries(PURPOSE).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-objetivo">Objetivo</label>
          <textarea id="f-objetivo" rows={3} maxLength={500} value={v.objetivo} onChange={set('objetivo')} />
          <span className="hint">Se muestra a los compradores: para qué se junta la plata.</span>
        </div>
        <div className="grid2">
          {field('metaMonto', 'Meta (CLP)', num)}
          {field('fechaSorteo', 'Fecha y hora del sorteo', { type: 'datetime-local' })}
        </div>
        {field('numeroAutorizacion', 'N° de autorización (opcional)', { maxLength: 60 })}
      </fieldset>

      <fieldset className="card">
        <legend>Números y precio</legend>
        {structureLocked && <p className="muted small">El precio y los talonarios solo se pueden cambiar mientras la rifa es borrador.</p>}
        <div className="grid2">
          {field('precioNumero', 'Precio por número (CLP)', { ...num, min: 1, disabled: structureLocked })}
          {field('cantidadTalonarios', 'Cantidad de talonarios', { ...num, min: 1, max: 500, disabled: structureLocked })}
          {field('numerosPorTalonario', 'Números por talonario', { ...num, min: 1, max: 200, disabled: structureLocked })}
          {field('maxNumerosPorOrden', 'Máximo de números por reserva', { ...num, min: 1, max: 200 })}
          {field('ttlReservaDias', 'Días para pagar una reserva', { ...num, min: 1, max: 60 })}
        </div>
        {total > 0 && Number.isFinite(potential) && (
          <p className="muted small">
            {total} números en total · si se venden todos: <b>{money(potential)}</b>
          </p>
        )}
      </fieldset>

      <fieldset className="card">
        <legend>Datos para transferir</legend>
        <p className="muted small">Banco, número de cuenta y titular son obligatorios para activar la rifa.</p>
        <div className="grid2">
          {field('bancoTitular', 'Titular', { maxLength: 120 })}
          {field('bancoRut', 'RUT', { maxLength: 20 })}
          {field('bancoNombre', 'Banco', { maxLength: 80 })}
          {field('bancoTipoCuenta', 'Tipo de cuenta', { maxLength: 40 })}
          {field('bancoNumeroCuenta', 'N° de cuenta', { maxLength: 40 })}
          {field('bancoEmailAviso', 'Correo para avisos', { type: 'email', maxLength: 200 })}
        </div>
      </fieldset>

      {msg && <div className={`banner ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}
