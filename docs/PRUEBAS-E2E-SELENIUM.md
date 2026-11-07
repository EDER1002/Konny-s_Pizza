# Pruebas E2E con Selenium para Konny's Pizza

## Objetivo

Estas pruebas automatizan un navegador real contra el despliegue de Vercel. Son herramientas de QA: no forman parte del JavaScript que se entrega a los clientes y no sustituyen las pruebas unitarias ni las comprobaciones de RLS en Supabase.

## Ejecución recomendada: GitHub Actions

1. Publica estos archivos en la rama `main`.
2. Abre el repositorio en GitHub y entra en **Actions**.
3. Selecciona **Selenium E2E - Konny's Pizza**.
4. Pulsa **Run workflow**.
5. Para las pruebas básicas, deja desactivada la opción `run_full_inactivity`.
6. Abre la ejecución para consultar aprobadas, fallidas y omitidas.
7. Si hubo fallos, descarga el artefacto `evidencias-selenium` cuando se haya generado. Las capturas se guardan en el directorio temporal del runner, no dentro del repositorio.

El workflow apunta deliberadamente al dominio oficial `https://konys-pizza.vercel.app` y solo se ejecuta manualmente. No se activa en cada `git push` para evitar cargar innecesariamente la aplicación de producción.

## Pruebas incluidas

- Carga de la página principal y título.
- Carga de las secciones de mesas y carta, sin estados de error.
- Apertura y cierre del menú móvil.
- Validación de una reserva inválida, sin confirmar ni insertar una reserva.
- Acceso directo a `/admin` con consulta y fragmento manipulados: el panel debe permanecer oculto sin sesión.
- Ausencia de claves de sesión Supabase en `localStorage` y `sessionStorage`.
- Si se configuran credenciales de prueba, inicio de sesión y comprobación de que la sesión no sobrevive a una recarga.
- Opcionalmente, actividad tras 4 minutos y 15 segundos y cierre tras cinco minutos adicionales sin actividad. Esta prueba tarda alrededor de diez minutos.

## Pruebas administrativas opcionales

Para habilitar inicio de sesión y expiración real, crea dos secretos de Actions en **Settings → Secrets and variables → Actions**:

- `E2E_ADMIN_EMAIL`: correo de una cuenta administradora de prueba.
- `E2E_ADMIN_PASSWORD`: contraseña de esa cuenta.

No pongas estas credenciales en archivos, variables públicas, commits ni capturas. Se recomienda una cuenta de prueba, no la cuenta personal habitual. Las pruebas de Selenium no realizan cambios en mesas, platos ni reservas.

Si no configuras los secretos, GitHub Actions omitirá explícitamente las dos pruebas que necesitan iniciar sesión. Las pruebas públicas y de acceso no autenticado seguirán ejecutándose.

Para ejecutar la prueba completa de inactividad, activa `run_full_inactivity` al lanzar manualmente el workflow. Necesita credenciales y tarda aproximadamente diez minutos.

## Ejecución local opcional

Requiere Node.js 24.22.1 o posterior compatible con la versión fijada de Selenium, además de conexión a Internet para Selenium Manager.

```bash
npm install --no-save --package-lock=false selenium-webdriver@4.52.0
E2E_BASE_URL=https://konys-pizza.vercel.app node --test --test-reporter=spec tests/e2e/konys-publico.test.js
```

En ejecución local, Chrome debe estar instalado; Selenium Manager puede administrar el controlador y, cuando corresponde, el navegador. Las capturas locales se escriben en el directorio temporal del sistema.

## Límites

- No se envía una reserva válida ni se modifica información de producción.
- Un resultado de Selenium no demuestra por sí solo que RLS proteja todas las tablas y funciones RPC. Eso requiere pruebas de API/SQL con una identidad no privilegiada.
- La prueba de acceso directo verifica la interfaz sin sesión; no reemplaza la verificación de permisos en PostgreSQL.
- El tiempo de inactividad real se prueba únicamente cuando se habilita la prueba larga y existen credenciales administrativas de prueba.
