# Actualización de seguridad administrativa

## Qué cambia

- Supabase Auth usa `persistSession: false`, `autoRefreshToken: true` y `detectSessionInUrl: false`. Los tokens viven únicamente en memoria del cliente; al recargar la página, el administrador debe iniciar sesión otra vez. No se trasladan las credenciales a `sessionStorage` ni a cookies.
- La página `/admin` sigue siendo un recurso estático de Vercel. Por eso no se trata de ocultar su HTML como frontera de seguridad: las consultas de reservas y todas las escrituras administrativas requieren autenticación, el correo ya registrado en `public.administradores` y una sesión Auth activa.
- La migración `002-sesion-admin-inactividad.sql` registra el `session_id` emitido por Supabase Auth. Las políticas RLS de `mesas`, `horarios`, `platos` y `reservas` exigen un heartbeat recibido en los últimos cinco minutos y verifican que la sesión continúe presente en `auth.sessions`. La migración reconstruye las políticas estándar de esas cuatro tablas para que una política permisiva anterior no pueda anular el control. Antes de cambiar nada, aborta expresamente si encuentra una política personalizada con un nombre no reconocido; en ese caso hay que revisarla y adaptar el SQL antes de volver a ejecutarlo, en lugar de borrarla automáticamente. Una sesión inactiva no puede reactivarse con un heartbeat tardío.
- El navegador escucha `mousemove`, `keydown`, `click`, `scroll` y `touchstart`. A los cinco minutos exactos sin eventos, limpia el temporizador y los listeners, cierra la sesión local de Supabase y muestra el motivo. Los heartbeats se limitan a uno cada cinco segundos como máximo para evitar solicitudes excesivas por `mousemove`; por seguridad, la validación RLS puede rechazar una sesión hasta cinco segundos antes del límite local si la última interacción ocurrió justo después de un heartbeat.
- Las vistas públicas (mesas, horarios, carta y creación de reservas mediante RPC) conservan sus permisos originales. No se agregan roles ni credenciales nuevas.

## Aplicación en Supabase

1. Abre el proyecto correcto en Supabase.
2. Comprueba que ya se ejecutó `supabase/migraciones/001-seguridad.sql`. Si no, ejecútala primero.
3. En **SQL Editor > New query**, pega y ejecuta el archivo completo `supabase/migraciones/002-sesion-admin-inactividad.sql`.
4. Verifica en el editor que la ejecución termine sin errores. La migración es idempotente: puede volver a ejecutarse y no elimina reservas, mesas, platos ni administradores.
5. Despliega el código actualizado en Vercel después de ejecutar la migración. Durante la transición, la versión nueva falla de forma cerrada si las funciones de la migración todavía no existen.

Para instalaciones nuevas, `supabase/schema.sql` ya incluye la tabla, funciones, grants y políticas actualizadas; no hace falta ejecutar 002 después de ese esquema completo. La migración 002 es para bases existentes.

## Vercel y configuración

- No cambian `SUPABASE_URL`, `SUPABASE_ANON_KEY`, el nombre de las variables ni la clave pública.
- No se necesita una variable nueva ni una clave `service_role` / `sb_secret_`.
- `scripts/construir.js` copia el directorio `js/` completo mediante su lista blanca, por lo que incorpora automáticamente `js/inactividad.js`. Continúa excluyendo `js/config.js` local y `js/config.example.js`.
- `vercel.json` no requiere cambios: conserva `cleanUrls`, encabezados de seguridad y `Cache-Control: no-store` para `/admin`.

## Alcance y verificación

Las pruebas Node verifican la configuración sin persistencia, el comportamiento del temporizador con reloj simulado, la limpieza de listeners, las comprobaciones de sesión en las funciones de datos y el contrato de las políticas RLS. También se ejecuta el conjunto de pruebas existente y el proceso de construcción.

No se pudo ejecutar una prueba de integración contra la base real de Supabase ni simular peticiones PostgREST con una cuenta no administradora porque el ZIP no incluye URL, claves ni acceso al proyecto. La garantía en el servidor queda activa después de ejecutar la migración 002; la prueba definitiva en ese entorno consiste en intentar un `INSERT`/`UPDATE` REST a cada tabla con una sesión no administradora o sin bearer token (debe ser rechazado), y repetir con el token administrativo después de cinco minutos sin heartbeat (también debe ser rechazado).
