import { useEffect, useState } from 'react';

/**
 * Instalar la app en el celular o el computador.
 * Chrome, Edge y Android avisan con "beforeinstallprompt" que se puede instalar: se guarda el evento para ofrecer
 * un botón propio. En iPhone no existe ese aviso: se instala desde Compartir → "Agregar a inicio".
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Se llama una vez al cargar la página: el aviso puede llegar antes de que se abra el panel */
export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin la barra automática del navegador: se ofrece en el panel, no a los compradores
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** ¿Ya se abrió como app instalada? */
export const isStandalone = () =>
  Boolean(window.matchMedia?.('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true;

/** iPhone o iPad (el iPad moderno se presenta como Mac con pantalla táctil) */
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export interface InstallState {
  /** El navegador ofrece instalar con un clic */
  canPrompt: boolean;
  /** iPhone o iPad: se explica cómo agregarla a inicio */
  ios: boolean;
  /** Ya está instalada o se está usando como app */
  installed: boolean;
  /** Abre el diálogo del navegador; true si la persona aceptó */
  prompt(): Promise<boolean>;
}

export function useInstall(): InstallState {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return {
    canPrompt: deferred !== null,
    ios: isIOS(),
    installed: installed || isStandalone(),
    async prompt() {
      const ev = deferred;
      if (!ev) return false;
      deferred = null;
      notify();
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      return outcome === 'accepted';
    },
  };
}
