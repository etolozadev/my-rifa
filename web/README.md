# mis-rifas · Web (fase 1)

Front en React + TypeScript + Vite para los compradores: ver la rifa, elegir números y reservar, y seguir el estado de su
orden (datos bancarios, plazo y comprobante). Incluye el panel del equipo en `/admin`.

## Rutas

| Ruta | Qué hace |
| --- | --- |
| `/r/:slug` | Rifa: objetivo, avance hacia la meta, fecha del sorteo, premios, datos bancarios y grilla por talonario. Selección de números o de un talonario completo y reserva con nombre y contacto. |
| `/orden/:token` | Orden del comprador: estado, plazo de vencimiento, datos bancarios con botón copiar, subida de comprobante (JPG, PNG, WebP o PDF, máx. 5 MB) y enlace para volver. |
| `/r/:slug?v=<codigo>` | La misma rifa con el enlace de un vendedor: avisa con quién se compra, muestra disponibles los números de su talonario y la reserva queda a su nombre. |
| `/e/:token` | Enlace de pago previo: quien ya pagó N números elige exactamente N y su orden queda pagada. |
| `/invitacion/:token` | Aceptar una invitación al equipo (crea la cuenta o, con sesión, se une con un clic). |
| `/admin` | Panel del equipo (requiere sesión). Ver abajo. |

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173, reenvía /api a http://localhost:3000 (cambia con API_URL)
npm test           # 54 tests (lógica de selección y carga rápida, flujos del comprador, del panel y de la fase 2 con la API simulada)
npm run typecheck
npm run build      # genera dist/
```

Levanta antes la API (`../api`, `npm run dev`) y abre `/r/<slug>` con el slug de una rifa activa.

## Panel del equipo (`/admin`)

| Ruta | Qué hace |
| --- | --- |
| `/admin/login` | Ingreso con correo y contraseña (cuentas creadas con `user:create`). |
| `/admin` | Mis rifas y botón para crear una nueva (nace como borrador). |
| `/admin/rifas/:id` | **Resumen**: avance, enlace público para copiar, activar / cerrar / reabrir la venta con lista de lo que falta. |
| `/admin/rifas/:id/ordenes` | **Órdenes**: abre en "Por revisar" (pendientes con comprobante); confirmar pago, dar 7 días más, reactivar una vencida, cancelar o anular (con confirmación); búsqueda por nombre, contacto o número; enlace a WhatsApp; **Registrar venta** (talonario físico o pago por fuera, números con rangos `4, 7, 10-12`). |
| `/admin/rifas/:id/numeros` | **Números** por talonario y estado; al tocar uno se ve quién lo tiene; descarga CSV para Excel. |
| `/admin/rifas/:id/vendedores` | Organizador y editores: rendición por vendedor (vendidos, reservados, montos), su enlace y asignación de rangos de su talonario físico. |
| `/admin/rifas/:id/carga` | **Carga rápida**: pegar o importar CSV con `números; nombre; contacto[; pagada]`, vista previa con errores por línea, atribución a un vendedor; tras cargar quedan en el cuadro solo las líneas que fallaron. |
| `/admin/rifas/:id/enlaces` | **Enlaces de pago previo**: crear por N números (con comprador opcional), copiar, anular y ver si se usaron. |
| `/admin/rifas/:id/configuracion` | Solo organizador: datos de la rifa y bancarios (precio y talonarios bloqueados fuera de borrador), premios, equipo (editores y vendedores por correo) e invitaciones por link. |

Pestañas por rol: el **organizador** ve todas; el **editor** todas menos Configuración; el **vendedor** ve Resumen (con su
enlace y su rendición), Órdenes y Números (solo los datos de sus ventas), Carga rápida y Enlaces de pago (a su nombre).

- El panel se carga aparte (`React.lazy`): los compradores no descargan su código.
- Si la sesión vence, cualquier pantalla vuelve al login y, al ingresar, regresa donde estabas.
- Toda petición que cambia datos envía `X-Requested-With: mis-rifas` (protección CSRF de la API).
- Los permisos los decide la API; el front solo oculta lo que el rol no puede usar (un editor no ve Configuración).

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

## Producción

Con Docker, la imagen `prod` de `Dockerfile` sirve `dist/` con Nginx (`nginx.conf`) y reenvía `/api` al contenedor de la API;
ver "Producción con Docker" en el README de la raíz. Con el front y la API bajo el mismo dominio no hace falta CORS y las
cookies del panel funcionarán sin ajustes.
