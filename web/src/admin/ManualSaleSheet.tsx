import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, parseNumberList, type AdminRaffle } from '../lib/admin';
import { money, plural } from '../lib/format';
import { ContactPicker, NO_CONTACT, contactChoiceError, resolveContact, type ContactChoice } from './ContactPicker';
import { useAdminLoad } from './session';

interface Props {
  raffle: AdminRaffle;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Venta registrada por el equipo: talonarios físicos, efectivo o pagos que llegaron por fuera. */
export function ManualSaleSheet({ raffle, onClose, onDone }: Props) {
  const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;
  const [tipo, setTipo] = useState<'numeros' | 'talonario'>('numeros');
  const [numbers, setNumbers] = useState('');
  const [booklet, setBooklet] = useState('');
  const [nombre, setNombre] = useState('');
  const [contacto, setContacto] = useState('');
  const [canal, setCanal] = useState<'fisica' | 'manual'>('fisica');
  const [pagada, setPagada] = useState(true);
  const isSeller = raffle.rol === 'vendedor';
  const [sellerId, setSellerId] = useState('');
  const sellers = useAdminLoad(() => (isSeller ? Promise.resolve([]) : adminApi.sellers(raffle.id)), 300_000).data ?? [];
  const activeSellers = sellers.filter((s) => s.activo);
  // Personas de contacto: solo el organizador y los editores (un vendedor registra el teléfono del comprador)
  const contacts = useAdminLoad(() => (isSeller ? Promise.resolve([]) : adminApi.contacts(raffle.id)), 300_000).data ?? [];
  const [contactChoice, setContactChoice] = useState<ContactChoice>(NO_CONTACT);
  const [contactoVendio, setContactoVendio] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const parsed = tipo === 'numeros' ? parseNumberList(numbers, total) : null;
  const k = Number(booklet);
  const bookletErr = tipo === 'talonario' && (!Number.isInteger(k) || k < 1 || k > raffle.cantidadTalonarios) ? `Del 1 al ${raffle.cantidadTalonarios}` : null;
  const numbersErr = typeof parsed === 'string' ? parsed : null;
  const nameErr = nombre.trim().length < 2 ? 'Escribe el nombre' : null;
  const phone = contacto.trim();
  // Al menos una forma de ubicar al comprador: su teléfono o una persona de contacto
  const contactErr =
    phone && phone.length < 6
      ? 'Mínimo 6 caracteres'
      : !phone && contactChoice.mode === 'none'
        ? isSeller
          ? 'Escribe el teléfono del comprador'
          : 'Escribe el teléfono o elige una persona de contacto'
        : null;
  const pickerErr = contactChoiceError(contactChoice);
  const count = tipo === 'talonario' ? raffle.numerosPorTalonario : Array.isArray(parsed) ? parsed.length : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (numbersErr || bookletErr || nameErr || contactErr || pickerErr) return;
    setBusy(true);
    setError(null);
    try {
      const contactoId = await resolveContact(raffle.id, contactChoice);
      const res = await adminApi.manualSale(raffle.id, {
        ...(tipo === 'talonario' ? { tipo, talonario: k } : { tipo, numeros: parsed as number[] }),
        compradorNombre: nombre.trim(),
        ...(phone ? { compradorContacto: phone } : {}),
        ...(contactoId ? { contactoId, contactoVendio } : {}),
        canal,
        pagada,
        ...(sellerId ? { vendedorId: Number(sellerId) } : {}),
      });
      onDone(`Venta registrada (orden #${res.id}): ${plural(res.numeros.length, 'número', 'números')} para ${nombre.trim()}.`);
    } catch (err) {
      if (err instanceof ApiError && err.details?.noDisponibles) {
        setError(`Ya no están libres: ${(err.details.noDisponibles as number[]).join(', ')}`);
      } else {
        setError(err instanceof ApiError ? describeError(err) : 'No se pudo registrar la venta.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="sale-title" onSubmit={submit} noValidate>
        <h2 id="sale-title">Registrar venta</h2>

        <div className="field">
          <label htmlFor="s-tipo">Qué se vendió</label>
          <select id="s-tipo" ref={first} value={tipo} onChange={(e) => setTipo(e.target.value as 'numeros' | 'talonario')}>
            <option value="numeros">Números</option>
            <option value="talonario">Un talonario completo</option>
          </select>
        </div>
        {tipo === 'numeros' ? (
          <div className="field">
            <label htmlFor="s-numeros">Números</label>
            <input id="s-numeros" inputMode="numeric" placeholder="Ej: 4, 7, 10-12" value={numbers} onChange={(e) => setNumbers(e.target.value)} aria-invalid={touched && !!numbersErr} />
            <span className="hint">Separados por coma; usa un guion para rangos. Del 1 al {total}.</span>
            {touched && numbersErr && <span className="err">{numbersErr}</span>}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="s-talonario">N° de talonario</label>
            <input id="s-talonario" type="number" inputMode="numeric" min={1} max={raffle.cantidadTalonarios} value={booklet} onChange={(e) => setBooklet(e.target.value)} aria-invalid={touched && !!bookletErr} />
            {touched && bookletErr && <span className="err">{bookletErr}</span>}
          </div>
        )}

        <div className="field">
          <label htmlFor="s-nombre">Comprador</label>
          <input id="s-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} aria-invalid={touched && !!nameErr} />
          {touched && nameErr && <span className="err">{nameErr}</span>}
        </div>
        <div className="field">
          <label htmlFor="s-contacto">Teléfono del comprador</label>
          <input id="s-contacto" type="tel" value={contacto} onChange={(e) => setContacto(e.target.value)} aria-invalid={touched && !!contactErr} />
          {!isSeller && <span className="hint">Opcional si eliges una persona de contacto.</span>}
          {touched && contactErr && <span className="err">{contactErr}</span>}
        </div>
        {!isSeller && (
          <ContactPicker
            id="s-persona"
            label="Persona de contacto"
            contacts={contacts}
            value={contactChoice}
            onChange={setContactChoice}
            vendio={contactoVendio}
            onVendio={setContactoVendio}
            showErrors={touched}
            hint="A quién llamar por esta venta (por ejemplo, quien compró para un familiar)."
          />
        )}
        <div className="field">
          <label htmlFor="s-canal">Canal</label>
          <select id="s-canal" value={canal} onChange={(e) => setCanal(e.target.value as 'fisica' | 'manual')}>
            <option value="fisica">Talonario físico</option>
            <option value="manual">Otro (transferencia o efectivo directo)</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={pagada} onChange={(e) => setPagada(e.target.checked)} />
          Ya está pagada
        </label>
        {!pagada && <p className="muted small">Quedará pendiente por {plural(raffle.ttlReservaDias, 'día', 'días')}, como una reserva web.</p>}
        {activeSellers.length > 0 && (
          <div className="field">
            <label htmlFor="s-vendedor">Vendedor</label>
            <select id="s-vendedor" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">Sin vendedor</option>
              {activeSellers.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}
        {isSeller && <p className="muted small">La venta queda a tu nombre. Solo puedes usar números de tu talonario o libres.</p>}

        {error && <div className="banner error" role="alert">{error}</div>}

        <div className="row between">
          <span className="muted">Total</span>
          <b style={{ fontSize: '1.2rem' }}>{money(count * raffle.precioNumero)}</b>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Registrar'}</button>
        </div>
      </form>
    </div>
  );
}
