import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { InstallCard } from '../src/admin/InstallCard';
import { initInstall } from '../src/lib/install';

/** Lo que hace Chrome cuando la app se puede instalar */
function offerInstall(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
  ev.prompt = vi.fn(() => Promise.resolve());
  ev.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

// El aviso del navegador queda guardado entre tests (como en la página): el orden importa
beforeAll(() => initInstall());
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('instalar la app', () => {
  it('sin aviso del navegador (ni iPhone) no ofrece nada', () => {
    const { container } = render(<InstallCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('en iPhone explica cómo agregarla a inicio', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1');
    render(<InstallCard />);
    await user.click(screen.getByRole('button', { name: 'Cómo instalarla' }));
    expect(screen.getByRole('list', { name: 'Cómo instalarla en iPhone' })).toHaveTextContent(/Compartir.*Agregar a inicio/);
  });

  it('cuando el navegador lo permite, "Instalar app" abre su diálogo', async () => {
    const user = userEvent.setup();
    render(<InstallCard />);
    const ev = offerInstall();
    // Se evita la barra automática del navegador: se ofrece aquí
    expect(ev.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Instalar app' }));
    expect(ev.prompt).toHaveBeenCalled();
    // El aviso se usa una sola vez
    expect(screen.queryByRole('button', { name: 'Instalar app' })).not.toBeInTheDocument();
  });

  it('"Ahora no" la oculta y lo recuerda', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<InstallCard />);
    offerInstall();
    await user.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(screen.queryByRole('region', { name: 'Instala mis-rifas' })).not.toBeInTheDocument();
    unmount();
    render(<InstallCard />);
    offerInstall();
    expect(screen.queryByRole('region', { name: 'Instala mis-rifas' })).not.toBeInTheDocument();
  });

  it('abierta como app instalada no se ofrece', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)', addEventListener() {}, removeEventListener() {} }));
    const { container } = render(<InstallCard />);
    offerInstall();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('panel sin conexión', () => {
  // El panel se carga aparte (import diferido): se precarga para no esperar en el test
  beforeAll(() => import('../src/admin/AdminApp'));

  it('avisa que no hay conexión (no pide ingresar de nuevo) y se abre solo al volver', async () => {
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (!online) throw new TypeError('Failed to fetch');
        const body = url === '/api/auth/me' ? { id: 1, nombre: 'Ana', email: 'ana@example.cl' } : [];
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    render(<MemoryRouter initialEntries={['/admin']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Sin conexión' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    online = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByRole('heading', { name: 'Mis rifas' })).toBeInTheDocument();
  });
});
