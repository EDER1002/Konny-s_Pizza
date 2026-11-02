# Módulo administrativo: Recomendaciones

El módulo se integra en el panel administrativo existente. Usa la sesión de Supabase Auth ya iniciada, el cliente central de `js/supabase.js` y las políticas RLS existentes. No crea tablas, funciones RPC, usuarios ni conexiones adicionales.

## Datos y privacidad

`obtenerReservasAnalisis()` consulta únicamente `mesa_id`, `num_personas`, `fecha`, `hora_inicio` y `estado`. Recupera los resultados en páginas de 500 filas para no presentar como completo un análisis truncado por el límite de filas de Supabase. La consulta se ejecuta como el administrador autenticado y queda sujeta a RLS. La capacidad se obtiene de `mesas`; no se transfieren nombres ni contactos al módulo analítico.

Se incluyen mesas actualmente inactivas cuando tienen reservas históricas: la capacidad registrada sigue siendo relevante para interpretar esas reservas. No se realizan cambios sobre reservas ni mesas.

## Definición de indicadores

- **Reservas registradas:** todos los registros recuperados, sin excluir estados.
- **Confirmadas futuras:** estado `confirmada` y fecha/hora de inicio igual o posterior al instante actual de `America/Bogota`.
- **Confirmadas pasadas:** estado `confirmada` y fecha/hora de inicio anterior al instante actual de `America/Bogota`. Fechas u horas inválidas no se clasifican como pasadas ni futuras.
- **Completadas / Canceladas:** conteo exacto por estado.
- **Demanda por día y hora:** reservas `confirmada` y `completada`; se excluyen `cancelada` y estados desconocidos. La demanda por día mantiene los siete días. Una fecha inválida no se agrupa; una hora inválida conserva su conteo diario, pero no entra en la agrupación horaria.
- **Ocupación estimada:** promedio aritmético de `(num_personas / capacidad) * 100` por reserva no cancelada con personas y capacidad positivas y finitas. Se excluyen las filas con datos incompletos o inválidos; no se sustituye una capacidad faltante. Si no hay muestras válidas, se muestra “No calculable”. El porcentaje no representa ocupación simultánea, aforo ni disponibilidad.

Las columnas SQL `fecha` y `hora_inicio` son `date` y `time`. Se interpretan como valores de calendario local del restaurante, sin convertirlas a UTC. El instante actual se formatea explícitamente en `America/Bogota`.

## Reglas de recomendación

1. Si existen cancelaciones, se propone revisar su frecuencia y distribución.
2. Si hay reservas no canceladas agrupadas por hora, se identifica la hora con mayor conteo. Se aclara que es una concentración relativa, no una saturación.
3. Si la ocupación estimada alcanza el 80% y existen muestras válidas, se propone revisar asignación y capacidad.
4. Si no se activa ninguna regla, se informa que no hay alertas destacadas; esto no garantiza ausencia de problemas.

Cada recomendación presenta motivo, evidencia y acción sugerida. Ninguna ejecuta cambios.

## Actualización y límites

El botón consulta nuevamente reservas y mesas. Los eventos Realtime de `reservas` y `mesas` refrescan el análisis cuando la vista está abierta. Si llega un evento durante una carga, se consolida una recarga pendiente. Los resultados de una sesión anterior se descartan al cerrar sesión.

La paginación recorre páginas de 500 hasta recibir una página incompleta. Si la tabla cambia durante varias páginas, el resultado puede reflejar instantes ligeramente distintos; Realtime puede solicitar otra actualización cuando la vista está abierta. La conexión real, RLS, Realtime y el navegador requieren credenciales y un proyecto Supabase autorizado para su validación.

## Pruebas

Ejecutar `npm test`. Las pruebas del módulo son puras y no requieren conexión de Supabase.
