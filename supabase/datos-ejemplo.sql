-- =====================================================================
-- Datos de ejemplo para probar la app y grabar el video.
-- Ejecutar DESPUÉS de schema.sql (SQL Editor > New query > Run).
-- Las mesas y reservas son inventadas; la carta es la publicada por Konys.
-- =====================================================================

insert into public.mesas (nombre, zona, capacidad) values
  ('Mesa 1', 'terraza', 2),
  ('Mesa 2', 'terraza', 4),
  ('Mesa 3', 'salon',   6),
  ('Mesa 4', 'salon',   4),
  ('Mesa 5', 'salon',   8);

-- Carta de Konys: pizzas en cono de 18 cm con papas al horno.
-- Precios de referencia tomados de Rappi (sede El Prado, octubre de 2026).
-- No hay postres publicados, por eso esa categoría queda vacía y no se muestra.
insert into public.platos (nombre, categoria, descripcion, precio) values
  ('Hawaiana',        'pizzas', 'Tocineta, jamón ahumado y piña.',                                   28900),
  ('Mexicana',        'pizzas', 'Carne molida, maíz, pimentón, cebolla y picante.',                  28900),
  ('Vegetariana',     'pizzas', 'Champiñón, tomate, maíz, cebolla caramelizada y parmesano.',        28900),
  ('Chicken',         'pizzas', 'Pollo en cuadros y maíz.',                                          29900),
  ('BBQ',             'pizzas', 'Pollo en salsa BBQ y cebolla caramelizada.',                         29900),
  ('Teriyork',        'pizzas', 'Pollo, carne molida, cebolla caramelizada y pimentón.',             29900),
  ('Carbonara',       'pizzas', 'Tocineta, jamón ahumado, maíz y parmesano.',                        29900),
  ('Lasagna',         'pizzas', 'Salsa blanca, carne molida, tocineta, maíz y parmesano.',           29900),
  ('Especial',        'pizzas', 'Pollo, tocineta, jamón y champiñón.',                               30900),
  ('Carnes',          'pizzas', 'Peperoni, jamón ahumado y cábano.',                                 30900),
  ('Ikonica',         'pizzas', 'Nuggets de pollo apanado, jamón ahumado y cheddar.',                30900),
  ('Colombianita',    'pizzas', 'Carne desmechada, maduritos fritos, maíz y nacho.',                 30900),
  ('Konys Bucara',    'pizzas', 'Carne angus y mermelada de tocineta ahumada con ron y miel.',       30900),
  ('Mar y Tierra',    'pizzas', 'Camarón, pollo, pimentón y maíz.',                                  31900),
  ('Konys Bondiola',  'pizzas', 'Bondiola de cerdo ahumada, champiñones y parmesano.',               31900),
  ('Italianísima',    'pizzas', 'Jamón serrano, tomates asados, pesto y galleta de parmesano.',      31900),
  ('Marinera',        'pizzas', 'Camarón, pulpo, palmito y salsa especial.',                         32900),
  ('Fries Ikonicas',  'entradas', 'Papas al horno con chorizo santarrosano, salchicha llanera, carne, maicitos y queso costeño.', 38000),
  ('Papas a la francesa al horno', 'entradas', 'Porción de 200 g.',                                  10000),
  ('Pan de ajo',      'entradas', 'Porción de pan de ajo.',                                           2500),
  ('Granizada de limón',          'bebidas', 'También de yerbabuena, mandarina o naranja.',         9900),
  ('Granizada de maracumango',    'bebidas', 'Maracuyá y mango.',                                   10900),
  ('Granizada de limonada de coco', 'bebidas', 'También cerezada o piña colada.',                   11000),
  ('Limonada de panela',          'bebidas', 'Natural.',                                             7000),
  ('Coca-Cola 400 ml',            'bebidas', null,                                                   6000),
  ('Agua Cristal 600 ml',         'bebidas', 'Con o sin gas.',                                       6000);

-- Algunas reservas para que el panel y los slots ocupados se vean en la demo.
insert into public.reservas (mesa_id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin, estado)
select m.id, r.nombre, r.contacto, r.personas,
       (now() at time zone 'America/Bogota')::date + r.dias,
       r.inicio, r.inicio + interval '60 minutes', r.estado
from (values
  ('Mesa 3', 'Juan Pérez',   '3001112233', 4,  1, time '19:00', 'confirmada'),
  ('Mesa 1', 'María Gómez',  '3012223344', 2,  1, time '19:00', 'confirmada'),
  ('Mesa 4', 'Laura Díaz',   null,         4,  1, time '20:00', 'cancelada'),
  ('Mesa 2', 'Andrés Rojas', '3023334455', 2,  2, time '13:30', 'confirmada'),
  ('Mesa 3', 'Sofía Ruiz',   '3034445566', 6,  2, time '20:00', 'confirmada'),
  ('Mesa 1', 'Camilo Pardo', null,         2, -1, time '20:00', 'completada')
) as r(mesa, nombre, contacto, personas, dias, inicio, estado)
join public.mesas m on m.nombre = r.mesa;

-- PASO OBLIGATORIO: escribe aquí el correo del usuario admin que creaste en
-- Authentication > Users, quita los dos guiones del inicio y ejecútalo.
-- insert into public.administradores (email) values ('tu-correo@gmail.com');
