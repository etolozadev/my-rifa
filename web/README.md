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

Después del sorteo, `/r/:slug` muestra los **resultados**: número ganador por premio, el sorteo externo con su detalle, los
anulados con su motivo y, para cada sorteo al azar, la semilla y un botón **Verificar en mi navegador** que descarga la
lista de participantes y recalcula SHA-256(semilla) mod participantes con WebCrypto. El comprador ganador lo ve en `/orden/:token`.

**Avisos a compradores**: en Órdenes cada orden tiene un mensaje de WhatsApp ya redactado según su estado (recordatorio de
pago con los datos bancarios, pago confirmado, reserva vencida) y el filtro **Vencen pronto** (menos de 48 h). Si el contacto
no es un teléfono, el botón copia el mensaje.
| `/admin` | Panel del equipo (requiere sesión). Ver abajo. |

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173, reenvía /api a http://localhost:3000 (cambia con API_URL)
npm test           # 101 tests (selección, carga rápida, verificación y escenario del sorteo, contactos, pestañas y flujos de comprador y panel con la API simulada)
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
| `/admin/rifas/:id/contactos` | **Contactos** (organizador y editores): personas a quién llamar por una venta cuando el comprador no dejó teléfono (nombre, teléfono, nota). Muestra cuántas órdenes tiene cada una y, si vendió números, su rendición. No se elimina un contacto con órdenes. |
| `/admin/rifas/:id/carga` | **Carga rápida**: pegar o importar CSV con `números; nombre; teléfono[; pagada][; contacto]`, vista previa con errores por línea, atribución a un vendedor y persona de contacto para todo el lote (o por fila en la 5ª columna, con su nombre o teléfono); tras cargar quedan en el cuadro solo las líneas que fallaron. |
| `/admin/rifas/:id/enlaces` | **Enlaces de pago previo**: crear por N números (con comprador opcional), copiar, anular y ver si se usaron. |
| `/admin/rifas/:id/sorteo` | **Sorteo** (organizador sortea; editores lo ven): cerrar la venta, tirar números al agua antes de cada premio (al azar o de una tómbola física; quedan fuera de toda la rifa y se pueden anular), sortear cada premio al azar o registrar un resultado externo, aviso si hay reservas sin pagar, avisar al ganador por WhatsApp y anular con motivo. **Sorteo en vivo**: escenario a pantalla completa con el número como boleto gigante, tómbola que gira mientras responde el servidor y frena unos 4 s hasta el ganador (solo muestra números que participan), redoble de tambor grabado que crece mientras la tómbola frena (golpe final con platillo grabado, bombo y aplausos; si las grabaciones no cargan, se sintetizan con Web Audio), confeti y el nombre completo del ganador tal como está registrado. Se puede saltar la animación (botón o Escape), silenciar en cualquier momento (preferencia guardada en el navegador) y cerrar con Continuar; un número al agua se anuncia con "¡Al agua!" y el nombre completo de su dueño, el boleto se hunde y suena el sonido de perdedor, sin confeti. Con movimiento reducido no hay escenario ni confeti. |
| `/admin/rifas/:id/configuracion` | Solo organizador: datos de la rifa y bancarios (precio y talonarios bloqueados fuera de borrador), premios, equipo (editores y vendedores por correo) e invitaciones por link. |

La barra de pestañas se desplaza si no caben (dedo, rueda del mouse, teclado o flechas en los bordes) y mantiene centrada la pestaña activa.

Pestañas por rol: el **organizador** ve todas; el **editor** todas menos Configuración; el **vendedor** ve Resumen (con su
enlace y su rendición), Órdenes y Números (solo los datos de sus ventas), Carga rápida y Enlaces de pago (a su nombre).

- El panel se carga aparte (`React.lazy`): los compradores no descargan su código.
- Si la sesión vence, cualquier pantalla vuelve al login y, al ingresar, regresa donde estabas.
- Toda petición que cambia datos envía `X-Requested-With: mis-rifas` (protección CSRF de la API).
- Los permisos los decide la API; el front solo oculta lo que el rol no puede usar (un editor no ve Configuración).

## Sistema visual

La idea es el **talonario de rifa en papel**:

- La cabecera de la rifa (y la de la orden del comprador) es un **talón**: arriba la causa y el avance, y tras una
  línea perforada con muescas, lo necesario para comprar (sorteo, precio, disponibles).
- Cada número es un **boleto** con muescas laterales y cifras de numerador (`007`). Libre: blanco; elegido: petróleo con
  check; reservado: rayado ámbar; vendido: papel gris con timbre circular. Los estados se distinguen por forma, no solo por color.
- **Color** (variables en `src/styles.css`, con modo oscuro propio): papel `#F2F6F8`, tinta `#0F2A3D`, petróleo `#0B6178`
  para acciones y selección, y naranja numerador `#C2410C` **solo** para la acción de compra (`.btn.cta`: Reservar,
  Confirmar mis números). Todos los pares de texto cumplen WCAG AA (4,5:1) en claro y oscuro.
- **Tipografía**: Plus Jakarta Sans variable, alojada con la app (`@fontsource-variable`), cifras tabulares en montos y números.
- **Íconos**: Phosphor (`src/components/icons.ts`, importados uno a uno), siempre junto a un texto. Los avisos (`.banner`)
  llevan ícono por CSS además del color.
- Sin sombras repetidas: solo el talón, la barra de selección y la hoja de reserva se elevan; el resto son superficies planas.

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

## App instalable (PWA)

- `public/manifest.webmanifest`: nombre, íconos (`public/icons/`, el boleto de la marca) y modo pantalla completa.
  Abre en `/admin`. En iPhone se instala desde Compartir → "Agregar a inicio" (metaetiquetas en `index.html`).
- `public/sw.js` (solo en producción): nunca guarda `/api`; páginas primero desde la red (sin conexión, la última
  copia); archivos con hash desde el caché. Nginx sirve `sw.js` y el manifiesto sin caché, así cada despliegue llega.
- El panel muestra la tarjeta "Instala mis-rifas" cuando el navegador lo permite (`beforeinstallprompt`) o en iPhone
  (con las instrucciones); se puede descartar. Sin conexión, el panel avisa en vez de pedir ingresar de nuevo.
- Requiere HTTPS (en producción lo pone Coolify); en `localhost` también funciona para probar.

## Celulares

Diseño desde 320 px de ancho, sin desplazamiento horizontal de la página. En el panel, en pantallas chicas, la barra
superior se va al bajar y las pestañas quedan fijas arriba; los filtros van en una fila que se desliza. En la página
de la rifa, los datos para transferir aparecen después de los números (primero se elige y reserva).

## Sonidos del sorteo

En `src/admin/sonidos/`, en mono y MP3 de 96 kbps (≈ 330 KB en total, se descargan al abrir la pestaña Sorteo):

- `redoble.mp3`: 4,6 s de *Drum Roll – Concert Band*, United States Air Force Band. Dominio público (obra del gobierno de EE. UU.), vía [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Drum_Roll_-_Concert_Band_-_United_States_Air_Force_Band.mp3). En el navegador se convierte en un bucle sin costura (`makeSeamlessLoop`).
- `platillo.mp3`: un golpe de *CrashCymbalSample.ogg*, dominio público, vía [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:CrashCymbalSample.ogg), con caída suavizada.
- `aplausos.mp3` (al revelar al ganador) y `perdedor.mp3` (cuando un número se va al agua): aportados por el
  organizador, sin el silencio inicial para que suenen justo al revelar. Son opcionales: si no cargan, suenan la
  fanfarria o el chapuzón sintetizados.
