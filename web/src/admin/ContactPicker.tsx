import { adminApi, type ContactRef } from '../lib/admin';

/** Elección de persona de contacto: ninguna, una existente o una nueva que se crea al guardar */
export type ContactChoice = { mode: 'none' } | { mode: 'existing'; id: number } | { mode: 'new'; nombre: string; telefono: string };

export const NO_CONTACT: ContactChoice = { mode: 'none' };

/** Error de la elección (solo aplica a un contacto nuevo), o null */
export function contactChoiceError(c: ContactChoice): string | null {
  if (c.mode !== 'new') return null;
  if (c.nombre.trim().length < 2) return 'Escribe el nombre de la persona de contacto';
  if (c.telefono.trim().length < 6) return 'El teléfono de la persona de contacto debe tener al menos 6 caracteres';
  return null;
}

/** Devuelve el id del contacto elegido, creándolo antes si es nuevo */
export async function resolveContact(raffleId: number, c: ContactChoice): Promise<number | null> {
  if (c.mode === 'none') return null;
  if (c.mode === 'existing') return c.id;
  const created = await adminApi.createContact(raffleId, { nombre: c.nombre.trim(), telefono: c.telefono.trim(), nota: '' });
  return created.id;
}

interface Props {
  id: string;
  label: string;
  contacts: ContactRef[];
  value: ContactChoice;
  onChange: (c: ContactChoice) => void;
  vendio: boolean;
  onVendio: (v: boolean) => void;
  showErrors?: boolean;
  hint?: string;
}

export function ContactPicker({ id, label, contacts, value, onChange, vendio, onVendio, showErrors, hint }: Props) {
  const selectValue = value.mode === 'existing' ? String(value.id) : value.mode;
  const err = showErrors ? contactChoiceError(value) : null;
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'none') onChange(NO_CONTACT);
            else if (v === 'new') onChange({ mode: 'new', nombre: '', telefono: '' });
            else onChange({ mode: 'existing', id: Number(v) });
          }}
        >
          <option value="none">Sin persona de contacto</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} ({c.telefono})
            </option>
          ))}
          <option value="new">+ Agregar persona nueva…</option>
        </select>
        {hint && <span className="hint">{hint}</span>}
      </div>
      {value.mode === 'new' && (
        <div className="grid2">
          <div className="field">
            <label htmlFor={`${id}-nombre`}>Nombre del contacto</label>
            <input id={`${id}-nombre`} maxLength={120} value={value.nombre} onChange={(e) => onChange({ ...value, nombre: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-tel`}>Teléfono del contacto</label>
            <input id={`${id}-tel`} type="tel" maxLength={40} value={value.telefono} onChange={(e) => onChange({ ...value, telefono: e.target.value })} />
          </div>
        </div>
      )}
      {err && <span className="err">{err}</span>}
      {value.mode !== 'none' && (
        <label className="check">
          <input type="checkbox" checked={vendio} onChange={(e) => onVendio(e.target.checked)} />
          Esta persona vendió el número (rinde el dinero)
        </label>
      )}
    </div>
  );
}
