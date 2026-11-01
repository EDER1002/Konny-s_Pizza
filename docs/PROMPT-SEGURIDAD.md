# Prompt para pedirle a Claude una revisión de seguridad

Abre la carpeta del proyecto en Claude Code (o súbela a Claude) y pega el texto de abajo.
Sirve para repetir la revisión cada vez que hagas cambios grandes.

---

```text
Eres un auditor de seguridad de aplicaciones web. Revisa el proyecto "Konys Pizza – App de
reservas" (HTML/CSS/JavaScript sin framework + Supabase + Vercel) y CORRIGE lo que encuentres.
Hazlo tú todo; no me pidas que lo haga yo salvo los pasos que solo se pueden hacer en el panel
de Supabase, Vercel o GitHub.

CONTEXTO
- Es un proyecto universitario, pero está publicado en Internet: https://konys-pizza.vercel.app
- Los clientes reservan mesas sin cuenta (rol "anon" de Supabase). El administrador entra con
  correo y contraseña en /admin.
- El navegador solo debe tener la clave pública (sb_publishable_… / anon). Nunca la secreta.
- No cambies el diseño ni las funciones de la app, ni rompas los requisitos del documento
  (reserva en menos de 3 pasos, sin cuenta, sin doble reserva).

MÉTODOS QUE QUIERO QUE USES (marca cuáles hiciste)
1. Revisión de código estática contra el OWASP Top 10 (2021): control de acceso, inyección,
   XSS, configuración insegura, componentes vulnerables, fallas de identificación, integridad.
2. Búsqueda de secretos en TODO el historial de Git (git log -p), en .env, en js/ y en lo que
   se publica: claves sb_secret_, JWT con role=service_role, contraseñas, tokens.
3. Base de datos (supabase/schema.sql): políticas RLS de cada tabla, permisos GRANT/REVOKE
   (incluido TRUNCATE), funciones SECURITY DEFINER con search_path fijo, validaciones del
   lado del servidor, límites de tamaño, restricciones contra reservas cruzadas.
4. Pruebas de ataque reales como usuario anónimo contra la API (PostgREST): leer y escribir
   tablas directo, inyección SQL, HTML/JS en cada campo, valores negativos/nulos/enormes,
   fechas imposibles, mesas inexistentes, abuso (cientos de reservas seguidas), llamar a
   funciones internas. Monta una base PostgreSQL local para esto; NO ataques mi base real
   de Supabase.
5. XSS almacenado y reflejado en un navegador real (Playwright/Puppeteer): guarda cargas
   maliciosas en la base y abre la página pública y el panel admin.
6. Cabeceras HTTP y CSP en vercel.json (CSP, HSTS, X-Frame-Options, Permissions-Policy,
   nosniff, Referrer-Policy). Comprueba en navegador que la CSP no rompe la app.
7. Cadena de suministro: librerías cargadas desde CDN (versión fija), Google Fonts,
   npm audit si hay dependencias.
8. Qué archivos del repositorio quedan accesibles desde la URL pública (por ejemplo
   /supabase/schema.sql, /tests, /docs) y que solo se publique una lista blanca.
9. Autenticación y sesión del administrador: es_admin(), registro público de usuarios,
   fuerza bruta, cierre de sesión, páginas que no deben guardarse en caché.
10. Lógica de negocio: spam de reservas, reservar fuera de horario, cambiar la capacidad,
    cancelar reservas ajenas, enumerar datos de otros clientes.

QUÉ DEBES ENTREGAR
- Corrige el código, el SQL y la configuración. Si cambias la base de datos, actualiza
  supabase/schema.sql Y crea una migración idempotente nueva en supabase/migraciones/
  (que no borre datos) para mi base que ya existe, y pruébala dos veces sobre el esquema viejo.
- Agrega pruebas automáticas por cada hallazgo (tests/ y tests/db/pruebas.sql). Deben pasar
  todas: npm test, npm run test:bd y las pruebas en navegador.
- Escribe docs/SEGURIDAD.md con: tabla de hallazgos (gravedad, qué era, cómo se corrigió),
  lo que ya estaba bien, pruebas ejecutadas con resultados, riesgos que quedan y por qué,
  y los pasos manuales que me tocan a mí (con la ruta exacta del menú de Supabase/Vercel/GitHub).
- Dame la lista de archivos cambiados y los comandos de git (shell fish) para subirlo.
- Sé honesto: no digas que algo está arreglado si no lo probaste, y separa "explotable hoy"
  de "mala práctica sin riesgo inmediato".

REGLAS
- No me pidas contraseñas ni claves y no las repitas. Si ves una en el código, avísame.
- No hagas push ni commits por mí; dame los comandos.
- No uses mi base de datos real para pruebas destructivas.
```
