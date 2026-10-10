import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CaretLeftIcon, CaretRightIcon } from '../components/icons';

interface Props {
  label: string;
  items: { key: string; label: string; to: string }[];
  current: string;
}

/**
 * Pestañas de la rifa. Si no caben, se desplazan horizontalmente: con el dedo, con la rueda del mouse,
 * con el teclado (Tab) o con las flechas que aparecen en los bordes; la pestaña activa siempre queda a la vista.
 */
export function TabBar({ label, items, current }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  // Mientras el usuario no mueva la barra, la pestaña activa se mantiene centrada aunque cambien los anchos
  const touched = useRef(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  /** Centra una pestaña en la barra; cerca de los extremos va justo al borde (nunca queda bajo una flecha) */
  const center = useCallback((tab: HTMLElement | null | undefined, smooth: boolean) => {
    const el = ref.current;
    if (!el || !tab) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    let left = tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2;
    if (left > max - 48) left = max;
    if (left < 48) left = 0;
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    else el.scrollLeft = left;
  }, []);

  const centerActive = useCallback(() => {
    if (!touched.current) center(ref.current?.querySelector<HTMLElement>('[aria-current="page"]'), false);
    update();
  }, [center, update]);

  // Al entrar o cambiar de sección se centra la pestaña activa
  useEffect(() => {
    touched.current = false;
    centerActive();
  }, [current, centerActive]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Rueda vertical del mouse → desplazamiento horizontal (solo si hay algo que desplazar)
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      touched.current = true;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    const onUserScroll = () => {
      touched.current = true;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onUserScroll, { passive: true });
    el.addEventListener('pointerdown', onUserScroll, { passive: true });
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', centerActive);
    // Cambios de tamaño de la barra o de una pestaña (la fuente que termina de cargar, el zoom) vuelven a centrar
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => centerActive()) : null;
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    let alive = true;
    document.fonts?.ready.then(() => alive && centerActive());
    return () => {
      alive = false;
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onUserScroll);
      el.removeEventListener('pointerdown', onUserScroll);
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', centerActive);
      ro?.disconnect();
    };
  }, [update, centerActive]);

  const scrollBy = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    touched.current = true;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: 'smooth' });
  };

  return (
    <div className={`tabbar${edges.left ? ' more-left' : ''}${edges.right ? ' more-right' : ''}`}>
      {edges.left && (
        <button type="button" className="tab-arrow left" onClick={() => scrollBy(-1)} aria-label="Ver secciones anteriores" tabIndex={-1}>
          <CaretLeftIcon size={18} weight="bold" aria-hidden="true" />
        </button>
      )}
      <nav ref={ref} className="tabs" aria-label={label}>
        {items.map((t) => (
          <Link
            key={t.key}
            to={t.to}
            className={current === t.key ? 'active' : undefined}
            aria-current={current === t.key ? 'page' : undefined}
            onFocus={(e) => center(e.currentTarget, true)}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {edges.right && (
        <button type="button" className="tab-arrow right" onClick={() => scrollBy(1)} aria-label="Ver más secciones" tabIndex={-1}>
          <CaretRightIcon size={18} weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
