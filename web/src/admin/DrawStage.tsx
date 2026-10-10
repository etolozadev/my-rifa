import { useEffect, useRef } from 'react';
import { SpeakerHighIcon, SpeakerSlashIcon, TrophyIcon } from '../components/icons';
import { ticketNumber } from '../lib/format';

export interface StageState {
  phase: 'rolling' | 'reveal';
  numero: number;
  /** Nombre abreviado del ganador ("Juan S."), solo al revelar */
  ganador?: string | null;
}

interface Props {
  prize: { orden: number; nombre: string };
  total: number;
  stage: StageState;
  soundOn: boolean;
  onToggleSound: () => void;
  onSkip: () => void;
  onClose: () => void;
}

/** Escenario del sorteo en vivo: pantalla completa, número de boleto gigante, suspenso y revelación. */
export function DrawStage({ prize, total, stage, soundOn, onToggleSound, onSkip, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const reveal = stage.phase === 'reveal';

  useEffect(() => {
    if (reveal) closeRef.current?.focus();
  }, [reveal]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (reveal) onClose();
      else onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reveal, onClose, onSkip]);

  return (
    <div className={`stage ${reveal ? 'is-reveal' : 'is-rolling'}`} role="dialog" aria-modal="true" aria-labelledby="stage-title">
      <div className="stage-panel">
        <p className="stage-prize">
          {prize.orden}° premio · {prize.nombre}
        </p>
        <h2 id="stage-title" className="stage-title">
          {reveal ? (
            <>
              <TrophyIcon size={30} weight="duotone" aria-hidden="true" /> ¡Tenemos ganador!
            </>
          ) : (
            'Sorteando…'
          )}
        </h2>
        {/* Mientras gira no se anuncia cada número; al revelar, sí */}
        <div className="stage-ticket" aria-live={reveal ? 'assertive' : 'off'}>
          {reveal && <span className="sr-only">Número ganador </span>}
          <span aria-hidden={!reveal}>{ticketNumber(stage.numero, total)}</span>
        </div>
        {reveal && stage.ganador && <p className="stage-winner">{stage.ganador}</p>}
        <div className="row stage-actions">
          <button type="button" className="btn small" onClick={onToggleSound} aria-pressed={soundOn}>
            {soundOn ? <SpeakerHighIcon size={18} aria-hidden="true" /> : <SpeakerSlashIcon size={18} aria-hidden="true" />}
            {soundOn ? 'Sonido' : 'Sin sonido'}
          </button>
          {reveal ? (
            <button ref={closeRef} type="button" className="btn cta" onClick={onClose}>
              Continuar
            </button>
          ) : (
            <button type="button" className="btn small" onClick={onSkip}>
              Saltar animación
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
