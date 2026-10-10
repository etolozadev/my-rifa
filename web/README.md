# mis-rifas · Web pública (fase 1)

Front en React + TypeScript + Vite para los compradores: ver la rifa, elegir números y reservar, y seguir el estado de su
orden (datos bancarios, plazo y comprobante). El panel de administración es el siguiente paso.

## Rutas

| Ruta | Qué hace |
| --- | --- |
| `/r/:slug` | Rifa: objetivo, avance hacia la meta, fecha del sorteo, premios, datos bancarios y grilla por talonario. Selección de números o de un talonario completo y reserva con nombre y contacto. |
| `/orden/:token` | Orden del comprador: estado, plazo de vencimiento, datos bancarios con botón copiar, subida de comprobante (JPG, PNG, WebP o PDF, máx. 5 MB) y enlace para volver. |

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173, reenvía /api a http://localhost:3000 (cambia con API_URL)
npm test           # 22 tests (lógica de selección, formato y flujos completos con la API simulada)
npm run typecheck
npm run build      # genera dist/
```

Levanta antes la API (`../api`, `npm run dev`) y abre `/r/<slug>` con el slug de una rifa activa.

## Decisiones

- **Móvil primero**: casi todos abrirán el enlace desde WhatsApp. Botones de 46–48 px, barra fija con el total, hoja de reserva
  que sube desde abajo. Sin desbordes horizontales (revisado en 390 px y en escritorio).
- **Estados sin depender solo del color**: disponible (borde), seleccionado (relleno y ✓), reservado (rayado) y vendido (tachado);
  cada botón tiene `aria-label` con su estado y hay leyenda. Modo oscuro automático y `prefers-reduced-motion`.
- **Sin doble reserva visible**: la grilla se refresca cada 30 s y al volver a la pestaña; si alguien toma un número que tenías
  elegido se quita de tu selección y se avisa. Si la API responde 409 al reservar, se muestran los números tomados.
- **Talonario completo** solo si todos sus números están libres; si la selección es exactamente un talonario se envía como
  `tipo: talonario` (no cuenta contra el máximo de números sueltos por orden).
- **Privacidad**: el contacto solo se envía a la API; nunca se muestra. El enlace de la orden es secreto (token) y se guarda en
  este navegador para volver a él (localStorage, con manejo de fallo).

## Producción (Nginx en el VPS)

```nginx
server {
  server_name rifas.estebantoloza.cl;
  root /var/www/mis-rifas/web/dist;
  location /api/ { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Forwarded-For $remote_addr; client_max_body_size 6m; }
  location / { try_files $uri /index.html; }   # rutas del front (/r/…, /orden/…)
}
```

Con el front y la API bajo el mismo dominio no hace falta CORS y las cookies del panel funcionarán sin ajustes.
