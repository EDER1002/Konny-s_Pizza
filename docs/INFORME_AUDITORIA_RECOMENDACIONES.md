# Informe técnico — Konny's Pizza / módulo Recomendaciones

**Fecha de auditoría:** 2 de noviembre de 2026  
**Base de trabajo:** `Konny-s_Pizza-main(2).zip`  
**Referencia analítica:** `Konnys_Pizza_Laboratorio_PostgreSQL.zip`  
**Implementación auditada:** `Konnys_Pizza_Final_Recomendaciones.zip`

## 1. Resumen ejecutivo

Se inspeccionaron y extrajeron los tres ZIP. Los tres archivos pasaron la comprobación de integridad del contenedor ZIP (`testzip`: sin errores). El proyecto original contiene 53 archivos; la primera entrega contiene 55.

La primera entrega conserva todos los archivos del original: no se encontraron eliminaciones ni sustituciones del proyecto por el laboratorio. Frente al original, la primera entrega había agregado `js/recomendaciones.js` y `tests/recomendaciones.test.js`, y había modificado `admin.html`, `css/styles.css` y `js/admin.js`.

La primera entrega volvió a superar `npm test`: **52 pruebas aprobadas, 0 fallidas**. Sin embargo, las pruebas de Recomendaciones eran solo tres y no cubrían los defectos importantes detectados en la inspección.

Se corrigió la integración partiendo del proyecto original y conservando los cambios pertinentes de la primera entrega. El laboratorio se utilizó solo para estudiar la lógica; no se copiaron su servidor Express, autenticación, base PostgreSQL local ni sus datos de demostración.

## 2. Comparación de archivos

| Versión | Archivos | Agregados respecto al original | Modificados respecto al original | Eliminados |
|---|---:|---:|---:|---:|
| Proyecto original | 53 | — | — | — |
| Primera entrega | 55 | 2 | 3 | 0 |
| Entrega auditada | 57 | 4 | 4 | 0 |

**Archivos agregados en la entrega auditada**
- `js/recomendaciones.js`
- `tests/recomendaciones.test.js`
- `docs/RECOMENDACIONES.md`
- `docs/INFORME_AUDITORIA_RECOMENDACIONES.md`

**Archivos modificados**
- `admin.html`: opción y vista Recomendaciones; estado accesible y fecha de última actualización.
- `css/styles.css`: estilos acotados al nuevo módulo y presentación responsive.
- `js/admin.js`: navegación, renderizado, carga, estados de error, concurrencia y limpieza del ciclo de sesión.
- `js/supabase.js`: consulta analítica paginada con selección mínima de campos.

**Archivos eliminados:** ninguno.

Se conservaron los 53 archivos originales. `scripts/construir.js`, `scripts/generar-config.js`, `vercel.json`, `index.html`, el esquema SQL, las migraciones, las funciones RPC, las pruebas originales y el mecanismo de lista blanca no se modificaron.

## 3. Hallazgos de la primera entrega y correcciones

| Severidad | Hallazgo | Corrección |
|---|---|---|
| Alta | Capacidad faltante sustituida por 1, generando porcentajes engañosos. | Las filas sin capacidad o personas válidas se excluyen del cálculo y se cuentan como incompletas. |
| Alta | KPI de confirmadas pasadas no diferenciado correctamente. | Se separan confirmadas futuras y pasadas; fechas/horas inválidas no se clasifican en ninguna. |
| Alta | Consulta de reservas sin paginación explícita. | Nueva consulta por páginas de 500 filas, ordenadas por ID, hasta completar la lectura. |
| Alta | Eventos de tiempo real podían perderse durante una carga. | Se marca una actualización pendiente y se ejecuta una recarga consolidada al terminar. |
| Alta | Un error podía dejar cifras anteriores visibles como si fueran actuales. | Se limpian los resultados al iniciar la consulta y se comunica el error. |
| Media | Fechas dependían potencialmente de la zona horaria del equipo. | DATE/TIME se interpretan como calendario del restaurante; el instante actual se convierte explícitamente a `America/Bogota`. |
| Media | Recomendaciones sin evidencia/acción claramente estructurada. | Cada recomendación incluye motivo, evidencia y acción administrativa sugerida. |
| Media | Cobertura automatizada insuficiente. | Se amplían pruebas de estados, fechas, horas, capacidades, entradas inválidas y determinismo. |

## 4. Criterios de cálculo

- **Reservas registradas:** todos los registros consultados, incluidos los cancelados.
- **Confirmadas futuras:** `confirmada` con inicio posterior al instante actual de `America/Bogota`.
- **Confirmadas pasadas:** `confirmada` con inicio igual o anterior al instante actual de `America/Bogota`. Los valores de fecha/hora inválidos no se clasifican como pasados ni futuros.
- **Completadas y canceladas:** conteos exactos de sus estados.
- **Demanda por día/hora:** incluye `confirmada` y `completada`; excluye `cancelada` y estados desconocidos. Se muestran los siete días. Las fechas inválidas no se agrupan; una hora inválida no entra en demanda horaria.
- **Ocupación estimada:** promedio aritmético de `(num_personas / capacidad) * 100` para reservas confirmadas o completadas con ambos valores positivos y finitos. No se incluyen canceladas. No se inventan capacidades. Si no hay muestras válidas, se muestra “No calculable”.
- **Mesas inactivas:** se incluyen en análisis histórico cuando sus reservas existen, porque su capacidad sigue siendo relevante para el contexto de la reserva.

La ocupación es una estimación histórica de relación personas/capacidad por reserva; no mide ocupación simultánea, aforo real ni disponibilidad actual.

## 5. Consulta y seguridad

`obtenerReservasAnalisis()` utiliza el cliente Supabase central ya creado en `js/supabase.js`. Selecciona únicamente `mesa_id`, `num_personas`, `fecha`, `hora_inicio` y `estado`. No solicita nombres ni teléfonos. La capacidad se obtiene mediante la consulta existente de mesas.

La consulta paginada se ejecuta como el usuario autenticado y permanece sujeta a RLS. El esquema original otorga permisos de lectura de reservas a `authenticated` y la política administrativa existente exige `public.es_admin()`. No se alteraron tablas, políticas, grants, funciones RPC ni credenciales.

El módulo Recomendaciones no tiene un mecanismo de autenticación propio y solo aparece dentro del panel existente, que verifica la sesión administrativa.

El build se ejecutó con valores públicos ficticios de prueba (`https://example-project.supabase.co` y `TEST_PUBLIC_ANON_KEY_NOT_REAL`). Estos valores solo se utilizaron para probar el generador de configuración y **no están incluidos en el ZIP final**. El test original `tests/construir.test.js` contiene además un literal centinela deliberadamente ficticio para comprobar que el detector del build reconoce el patrón `sb_secret_`; no es una credencial y el directorio `tests/` queda fuera de `dist/`.

## 6. Pruebas y evidencias

| Prueba | Resultado | Evidencia | Limitación |
|---|---|---|---|
| Integridad de los tres ZIP | APROBADA | Los tres `ZipFile.testzip()` devolvieron `None`. | Ninguna para integridad ZIP. |
| Comparación original / primera entrega | APROBADA | 53 originales retenidos; 2 nuevos, 3 modificados, 0 eliminados en primera entrega. | Comparación por rutas y contenido; no valida ejecución. |
| Conservación en entrega auditada | APROBADA | 53 archivos originales retenidos; 4 nuevos, 4 modificados, 0 eliminados. | No es una prueba de navegador. |
| `npm test` en primera entrega | APROBADA | 52 aprobadas, 0 fallidas. | Cobertura específica inicial insuficiente. |
| `npm test` en entrega corregida | APROBADA | 71 pruebas, 71 aprobadas, 0 fallidas. | Pruebas automatizadas locales; no consultan Supabase real. |
| Pruebas con `TZ=America/Bogota` | APROBADA | 71 aprobadas, 0 fallidas. | Ejecución local. |
| Pruebas con `TZ=Pacific/Honolulu` | APROBADA | 71 aprobadas, 0 fallidas. | Ejecución local para comprobar independencia de zona del host. |
| `node --check` en módulos modificados | APROBADA | `js/admin.js`, `js/recomendaciones.js` y `js/supabase.js` sin errores sintácticos. | No sustituye ejecución en navegador. |
| IDs duplicados y navegación HTML | APROBADA | Sin IDs duplicados; las cinco vistas y cinco botones coinciden. | Inspección estática. |
| `npm run build` | APROBADA | Build correcto con variables ficticias de prueba; generó 13 archivos. | No usa credenciales reales ni despliega. |
| Inclusión del módulo en `dist` | APROBADA | `dist/js/recomendaciones.js` presente. | Build local. |
| Lista blanca y exclusión de SQL/tests/.env | APROBADA | `dist` contiene 13 archivos permitidos; no se encontraron SQL, tests, `.env` ni `config.example.js`. | El ZIP final no incluye `dist`. |
| Pruebas SQL (`tests/db/correr.sh`) | BLOQUEADA POR ENTORNO | El script no pudo iniciar: `initdb: command not found`. | No hay herramientas PostgreSQL (`initdb`, `pg_ctl`, `psql`) disponibles. |
| Navegador / responsive / consola | NO EJECUTADA | No se dispuso de navegador de prueba en esta sesión. | Requiere ejecución visual. |
| Supabase real / RLS | BLOQUEADA POR ENTORNO | No se proporcionaron credenciales ni proyecto de pruebas conectado. | No se hicieron consultas reales ni cambios en la base. |
| Supabase Realtime | BLOQUEADA POR ENTORNO | Contrato revisado en código; no se abrió una sesión Realtime real. | Falta proyecto y sesión autorizados. |
| Despliegue Vercel | NO EJECUTADA | No se ejecutó despliegue. | Requiere acceso al proyecto Vercel. |
| Extracción y pruebas del ZIP final | APROBADA | ZIP final extraído en carpeta independiente; `npm test` ejecutado sobre la copia extraída. | Sigue sin probar Supabase o navegador. |

## 7. Build y despliegue

El build conserva el proceso original. No fue necesario modificar `scripts/construir.js`: su lista blanca ya copia el directorio `js/`, por lo que incorpora automáticamente `js/recomendaciones.js`.

**Ejecución local**, siguiendo el README original:
1. Copiar `js/config.example.js` como `js/config.js` y configurar la URL y la clave pública anon/publishable del proyecto Supabase. Nunca usar `service_role` ni claves secretas.
2. Ejecutar `npm test`.
3. Ejecutar `npm run dev`.
4. Abrir `http://localhost:5500`; el panel está en `http://localhost:5500/admin`.

**Despliegue Vercel**, según el README original:
1. Importar el repositorio de GitHub en Vercel.
2. Configurar las variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` en Vercel.
3. Ejecutar Deploy. `vercel.json` conserva el comando de build original y `scripts/construir.js` genera `dist/`.

## 8. Limitaciones pendientes

1. Ejecutar pruebas SQL requiere PostgreSQL local con `initdb`, `pg_ctl` y `psql`.
2. Verificar autenticación, permisos RLS, paginación real y Realtime requiere un proyecto Supabase de pruebas y una cuenta administrativa autorizada.
3. Verificar navegación, responsive, accesibilidad visual, red y consola requiere navegador.
4. El despliegue real requiere acceso al proyecto Vercel.
5. La paginación por rangos evita truncamiento por página, pero no proporciona una instantánea transaccional entre páginas si la tabla cambia durante la lectura. Los eventos Realtime pueden disparar otra actualización cuando la vista está abierta.

No se ejecutaron migraciones, no se insertaron/cancelaron reservas reales y no se modificaron datos de producción.

## 9. Conclusión

La entrega auditada conserva el proyecto original y limita los cambios a Recomendaciones y su consulta mínima de datos. Las pruebas automatizadas, las comprobaciones sintácticas y el build local están aprobados. La validación real de Supabase, RLS, Realtime, navegador y Vercel queda expresamente pendiente por falta de entorno y credenciales.
