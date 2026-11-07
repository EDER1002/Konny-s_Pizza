# MANIFEST — Konny's Pizza: actualización de seguridad

Este paquete contiene solo los archivos relacionados con los tres requisitos de seguridad. Las rutas se conservan desde la raíz del repositorio `Konny-s_Pizza-main/`; extrae su contenido sobre la raíz de tu repositorio.

## Archivos modificados

| Archivo | Motivo |
|---|---|
| `js/supabase.js` | Desactiva la persistencia de sesión; registra, verifica y cierra sesiones administrativas; exige sesión vigente antes de consultar reservas o realizar operaciones CRUD. |
| `js/admin.js` | Integra el cierre por inactividad, renueva la actividad del lado servidor, limpia suscripciones y muestra el aviso de cierre. |
| `js/logica.js` | Añade un mensaje claro para la sesión administrativa expirada. |
| `supabase/schema.sql` | Incluye el modelo de actividad de sesión y las políticas RLS requeridas para instalaciones nuevas. |

## Archivos nuevos

| Archivo | Motivo |
|---|---|
| `js/inactividad.js` | Control independiente y comprobable de los cinco minutos de inactividad y limpieza de eventos/temporizadores. |
| `supabase/migraciones/002-sesion-admin-inactividad.sql` | Migración idempotente para bases existentes: heartbeat por `session_id`, comprobación de `auth.sessions` y endurecimiento de las políticas RLS. |
| `tests/seguridad.test.js` | Pruebas de no persistencia, temporizador, actividad, limpieza, protección de operaciones y contrato SQL/RLS. |
| `docs/SEGURIDAD-INACTIVIDAD.md` | Documentación de cambios, despliegue y pasos manuales en Supabase/Vercel. |

## Archivos revisados que no necesitan modificación

- `admin.html`: su contenido estático puede descargarse, pero no otorga permisos; las operaciones quedan en RLS.
- `vercel.json`: ya conserva las reglas de ruta, cabeceras de seguridad y `no-store` de `/admin`.
- `scripts/construir.js`: copia de forma recursiva los módulos JS autorizados y excluye la configuración sensible local.
- `js/config.js`: deliberadamente excluido del paquete para no sobrescribir configuración local.

## No incluido

No se incluye el proyecto completo, `.git`, `node_modules`, `dist`, `js/config.js`, `.env`, credenciales, imágenes, archivos personales ni archivos sin relación con estos cambios.
