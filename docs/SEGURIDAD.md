# Informe de seguridad · Konys Pizza

Revisión hecha el 1 de noviembre de 2026 sobre el código del repositorio, la base de datos
(`supabase/schema.sql`) y la publicación en Vercel. Las pruebas se hicieron en un entorno local
idéntico al real (PostgreSQL 16 + PostgREST, la misma capa que usa Supabase) atacando como lo haría
una persona anónima que solo tiene la clave pública del navegador.

## 1. Resultado en una frase

Antes de la revisión la app ya estaba protegida contra lo más grave (nadie anónimo podía leer
reservas ni cambiar mesas, y el HTML de los usuarios se escapa en pantalla). Se encontraron
**8 puntos a mejorar**, de los cuales los más importantes eran: cualquiera podía llenar el
restaurante con reservas falsas, y se publicaba todo el repositorio (incluido el SQL) en Internet.
**Los 8 quedaron corregidos** y quedan **5 pasos manuales** en Supabase y GitHub (sección 5).

## 2. Qué se revisó y cómo

| Método | Qué se hizo |
|---|---|
| Revisión de código | Lectura de todo el JavaScript, HTML y SQL buscando inyección, XSS, validaciones faltantes y permisos de sobra. |
| Búsqueda de secretos | Búsqueda de claves `sb_secret_`, JWT `service_role`, contraseñas y `.env` en todo el historial de Git. Resultado: limpio. |
| Pruebas de ataque a la API | 36 ataques con solo la clave pública: leer/escribir/borrar tablas, inyección SQL, HTML en campos, valores fuera de rango, fechas imposibles, reservas en masa. |
| XSS almacenado | Se metieron datos maliciosos directamente en la base (nombre de reserva, mesa, plato, foto `javascript:`) y se abrió la página pública y el panel admin en un navegador real para confirmar que no se ejecuta nada. |
| Cabeceras y CSP | Verificación en navegador de que la política de seguridad de contenido (CSP) no rompe la app y que bloquea scripts inyectados. |
| Cadena de suministro | Revisión de lo que se carga desde terceros (supabase-js, Google Fonts). |
| Exposición de archivos | Qué archivos del repositorio quedan accesibles desde la URL pública. |

Referencia usada: OWASP Top 10 (2021).

## 3. Hallazgos y correcciones

| # | Gravedad | Hallazgo (OWASP) | Corrección |
|---|---|---|---|
| 1 | **Alta** | **Sin límite de reservas.** Un bot podía hacer reservas falsas sin parar: en la prueba se aceptaron 40 de 40 desde un mismo origen y el restaurante quedaba sin mesas libres. (A04 Diseño inseguro) | `crear_reserva` ahora acepta máximo **10 reservas por hora por IP**. Se guarda solo un hash SHA-256 de la IP, nunca la IP, y los registros se borran a las 24 h. Mensaje claro al usuario (`DEMASIADAS_RESERVAS`). |
| 2 | **Media** | **Todo el repositorio se publicaba** (`outputDirectory: "."`): `/supabase/schema.sql`, `/tests/`, `/docs/` eran accesibles desde Internet. No tiene claves, pero le da un mapa completo de la base a un atacante. (A05 Configuración insegura) | Nuevo `scripts/construir.js`: arma `dist/` con una **lista blanca** (solo páginas, CSS, JS e imágenes) y falla si encuentra una clave secreta. `vercel.json` publica solo `dist/`. 6 pruebas automáticas. |
| 3 | **Media** | **Sin cabeceras de seguridad**: sin CSP, sin protección contra clickjacking (la página se podía meter en un `<iframe>` ajeno), sin HSTS. (A05) | `vercel.json` agrega `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `nosniff` y `Referrer-Policy`. El panel `/admin` además va con `no-store` y `noindex`. |
| 4 | **Media** | **Nombre y contacto sin validar en el servidor**: la base aceptaba `<img onerror=…>`, `<script>`, saltos de línea y texto cualquiera como teléfono (`<b>hola</b>`, `1' OR '1'='1`). Hoy no se ejecutaba porque la pantalla escapa el texto, pero un solo olvido futuro lo volvería un XSS. (A03 Inyección) | La función y las tablas rechazan `<`, `>` y caracteres de control en el nombre, y exigen que el teléfono sean solo números, `+`, paréntesis, guiones y espacios (7 a 20). El formulario valida lo mismo para avisar antes. |
| 5 | **Media-baja** | **Permisos de sobra** para los roles `anon` y `authenticated`: Supabase les da todos los permisos por defecto (incluso `TRUNCATE`, que RLS no controla). No era explotable por la API, pero rompe el principio de mínimo privilegio. (A01 Control de acceso) | `revoke` de todo y `grant` solo de lo necesario: el público solo lee mesas, horarios y carta; el administrador no puede vaciar tablas; las funciones internas ya no se pueden llamar desde fuera. |
| 6 | **Baja** | **Funciones `SECURITY DEFINER` con `search_path = public`**, una configuración que permite secuestrar funciones si alguien lograra crear objetos en `public`. (A04) | Todas las funciones usan `set search_path = ''` con nombres completos. |
| 7 | **Baja** | **supabase-js sin versión fija** (`@2`): si el paquete se alterara o cambiara, la app lo cargaría sin enterarse. (A08 Integridad / cadena de suministro) | Versión fijada a `2.118.0`; la CSP solo permite scripts de la propia página y de `cdn.jsdelivr.net`. |
| 8 | **Baja** | **Fotos de mesas con `http://`** (y sin límite): permitía enlaces inseguros o `javascript:` si el admin se equivocaba o su cuenta era vulnerada. (A03) | Solo `https://`, sin espacios ni `<>"`, máximo 500 caracteres: validado en el formulario, al mostrar la imagen y como regla de la base de datos. |

### Lo que ya estaba bien (se comprobó con pruebas)

- El público **no puede leer** reservas, ni la lista de administradores, ni el registro del limitador.
- El público **no puede crear, cambiar ni borrar** mesas, horarios, platos o reservas directamente: solo mediante `crear_reserva`.
- `crear_reserva` rechaza personas negativas/cero/nulas, más personas que la capacidad, fechas pasadas o a más de 30 días, horas fuera del horario o que no empiezan un turno, mesas inexistentes o inactivas, y nombres vacíos o de 5000 letras.
- La doble reserva es imposible aunque dos personas reserven en el mismo segundo (restricción `reservas_sin_cruce` en la base).
- Inyección SQL: no hay concatenación de consultas; todo viaja como parámetro. `Robert'); DROP TABLE reservas;--` se trató como texto y la tabla siguió existiendo.
- Todo texto de usuario se escapa antes de mostrarse (`escaparHTML`). El XSS almacenado no se ejecutó ni en la página pública ni en el panel admin, ni siquiera con la CSP desactivada en la prueba de escape.
- Las claves: solo la clave pública llega al navegador; `generar-config.js` y `construir.js` se niegan a usar una clave secreta. No hay secretos en el historial de Git.
- Los enlaces externos llevan `rel="noopener"`.

## 4. Pruebas que lo respaldan

| Prueba | Resultado |
|---|---|
| Pruebas unitarias (`npm test`) | 49 pasan (7 nuevas: validación de nombre/contacto, mensajes, build seguro) |
| Pruebas de la base (`npm run test:bd`) | 83 pasan (24 nuevas: permisos, `TRUNCATE`, HTML, SQL, foto, límite por IP) |
| Navegador, página pública | 19 de 19 |
| Navegador, panel admin | 19 de 19 |
| Batería de 36 ataques a la API | Antes: 26 bloqueados, **10 vulnerables**. Después: **36 bloqueados**. |
| XSS almacenado en navegador | 4 de 4 (sin ejecución de código; la CSP bloquea scripts y `onerror` inyectados a la fuerza) |
| Migración sobre la base ya creada | No borra datos, se puede ejecutar dos veces, deja los mismos permisos que un esquema nuevo |

## 5. Pasos manuales pendientes (no se pueden hacer desde el código)

1. **Ejecutar la migración** `supabase/migraciones/001-seguridad.sql` en Supabase > SQL Editor (una sola vez; si se repite no pasa nada). Sin esto la base real sigue como antes.
2. **Desactivar el registro público**: Supabase > Authentication > Sign In / Providers > Email > apagar *Allow new users to sign up*. Así nadie puede crearse una cuenta; el administrador ya existe.
3. **Contraseñas**: cambiar la contraseña de la base de datos (Project Settings > Database > Reset database password) y la del administrador, porque ambas se escribieron en un chat. Usar contraseñas de 14+ caracteres, únicas. Opcional pero recomendado: activar autenticación en dos pasos en la cuenta de Supabase y de GitHub.
4. **GitHub**: Settings > Code security > activar *Secret scanning* y *Push protection* (gratis en repos públicos), y *Dependabot alerts*.
5. **Vercel**: en Settings > Environment Variables dejar **solo** `SUPABASE_URL` y `SUPABASE_ANON_KEY` (clave `sb_publishable_…`). Nunca la `sb_secret_…` (ya se borró en Supabase).

## 6. Riesgos que quedan (aceptados, con motivo)

- **Límite por IP aproximado.** Varias personas en una misma red móvil (CGNAT) comparten IP; por eso el tope es 10 por hora y no 3. Un atacante con muchas IPs (VPN, botnet) puede superarlo. Si algún día hay abuso real, el siguiente paso es agregar CAPTCHA (Cloudflare Turnstile) al formulario.
- **Reservas falsas con datos válidos.** Como la reserva no exige cuenta (requisito del proyecto: menos de 3 pasos), no se puede verificar que el nombre sea real. El administrador puede cancelar reservas desde el panel.
- **Sin SRI en supabase-js.** Los módulos ES importados desde un CDN no admiten `integrity`. Se mitiga con versión fija y CSP; la opción más fuerte sería copiar la librería dentro de `js/vendor/`.
- **Fuerza bruta al login del admin.** Lo limita Supabase Auth por su cuenta; se refuerza con contraseña larga y 2FA.
- **El teléfono y el nombre son datos personales.** Solo el administrador los ve (RLS). Conviene borrar reservas pasadas cada cierto tiempo.
- **La IP no es un dato 100 % confiable** si alguien llamara a la API de Supabase saltándose su proxy; en producción Supabase la fija en su borde, por eso se usa `cf-connecting-ip`.

## 7. Cómo repetir esta revisión

Pegarle a Claude Code, con el repositorio abierto, el prompt de `docs/PROMPT-SEGURIDAD.md`.
