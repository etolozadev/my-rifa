import { useState } from 'react';
import { DeviceMobileIcon, ExportIcon } from '../components/icons';
import { useInstall } from '../lib/install';

const DISMISS_KEY = 'mis-rifas:instalar-oculto';
const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Invitación a instalar la app, en el inicio del panel. Solo aparece si el navegador lo permite (o en iPhone, con
 * las instrucciones), mientras no esté instalada y si no se descartó.
 */
export function InstallCard() {
  const install = useInstall();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [howTo, setHowTo] = useState(false);

  if (install.installed || dismissed || (!install.canPrompt && !install.ios)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sin almacenamiento: vuelve a aparecer la próxima vez */
    }
  };

  return (
    <section className="card install" aria-labelledby="install-title">
      <div className="install-head">
        <DeviceMobileIcon size={28} weight="duotone" aria-hidden="true" />
        <div>
          <h2 id="install-title">Instala mis-rifas</h2>
          <p className="muted small">Ábrela como una app desde el inicio del celular o el escritorio del computador, sin buscar el enlace.</p>
        </div>
      </div>
      {howTo && (
        <ol className="install-steps small" aria-label="Cómo instalarla en iPhone">
          <li>
            Toca <b>Compartir</b> <ExportIcon size={18} aria-hidden="true" /> (el cuadrado con una flecha hacia arriba) en la barra del navegador.
          </li>
          <li>
            Elige <b>Agregar a inicio</b> (o "Agregar a pantalla de inicio") y confirma con <b>Agregar</b>.
          </li>
        </ol>
      )}
      <div className="row">
        {install.canPrompt ? (
          <button type="button" className="btn primary" onClick={() => void install.prompt()}>
            Instalar app
          </button>
        ) : (
          !howTo && (
            <button type="button" className="btn primary" onClick={() => setHowTo(true)}>
              Cómo instalarla
            </button>
          )
        )}
        <button type="button" className="btn" onClick={dismiss}>
          Ahora no
        </button>
      </div>
    </section>
  );
}
