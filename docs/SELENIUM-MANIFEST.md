# Manifiesto de la incorporación Selenium E2E

## Archivos nuevos

- `.github/workflows/selenium-e2e.yml`: workflow manual de GitHub Actions que ejecuta Selenium contra el despliegue de Vercel.
- `tests/e2e/konys-publico.test.js`: pruebas E2E no destructivas; las pruebas que necesitan administrador son opcionales y usan secretos de GitHub.
- `docs/PRUEBAS-E2E-SELENIUM.md`: instrucciones de ejecución, secretos opcionales y límites de las pruebas.

## Archivos existentes modificados

Ninguno. El paquete no reemplaza `.gitignore`, `package.json`, `README.md`, archivos de la aplicación ni configuraciones de Supabase/Vercel.

## Seguridad y alcance

- El workflow es manual y apunta al dominio oficial de Vercel.
- Las pruebas de reserva solo validan un formulario inválido y no insertan registros.
- Las pruebas administrativas de inicio de sesión e inactividad requieren secretos configurados por el propietario del repositorio.
- No se guardan credenciales dentro del repositorio.
- Selenium se instala solo en el runner temporal de GitHub Actions y no se incluye en el sitio publicado.
