import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

// Selenium se ejecuta únicamente en el entorno de pruebas; no forma parte
// del JavaScript que Vercel publica para los clientes.
const require = createRequire(import.meta.url);
const { Builder, Browser, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const BASE_URL = new URL(
  process.env.E2E_BASE_URL || 'https://konys-pizza.vercel.app',
);
const WAIT_MS = 30_000;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';
const HAS_ADMIN_CREDENTIALS = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);
const RUN_SLOW_INACTIVITY = process.env.E2E_RUN_SLOW_INACTIVITY === 'true';

if (BASE_URL.protocol !== 'https:' && BASE_URL.hostname !== 'localhost') {
  throw new Error('E2E_BASE_URL debe usar HTTPS (excepto localhost).');
}

function url(path) {
  return new URL(path, BASE_URL).toString();
}

async function crearNavegador() {
  const opciones = new chrome.Options().addArguments(
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1440,1100',
  );

  const driver = await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(opciones)
    .build();

  await driver.manage().setTimeouts({
    implicit: 0,
    pageLoad: 45_000,
    script: 15_000,
  });

  return driver;
}

async function capturarFallo(driver, nombre) {
  if (!driver) return;
  try {
    const carpeta = join(process.env.RUNNER_TEMP || tmpdir(), 'konys-pizza-selenium');
    await mkdir(carpeta, { recursive: true });
    const archivo = nombre
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');
    const imagen = await driver.takeScreenshot();
    await writeFile(join(carpeta, `${archivo || 'fallo'}.png`), imagen, 'base64');
    console.error(`Captura de evidencia: ${join(carpeta, `${archivo || 'fallo'}.png`)}`);
  } catch (error) {
    console.error('No se pudo guardar la captura de Selenium:', error.message);
  }
}

async function conNavegador(nombre, ejecutar) {
  let driver;
  try {
    driver = await crearNavegador();
    return await ejecutar(driver);
  } catch (error) {
    await capturarFallo(driver, nombre);
    throw error;
  } finally {
    if (driver) {
      await driver.quit().catch((error) => {
        console.error('No se pudo cerrar Chrome:', error.message);
      });
    }
  }
}

async function esperarVisible(driver, selector, mensaje = `No apareció ${selector}`) {
  const elemento = await driver.wait(until.elementLocated(By.css(selector)), WAIT_MS, mensaje);
  await driver.wait(until.elementIsVisible(elemento), WAIT_MS, mensaje);
  return elemento;
}

async function leerAlmacenamientoAuth(driver) {
  return driver.executeScript(() => {
    const claves = [
      ...Object.keys(window.localStorage),
      ...Object.keys(window.sessionStorage),
    ];
    return claves.filter((clave) =>
      /supabase|sb-.+-auth-token|access.?token|refresh.?token/i.test(clave),
    );
  });
}

async function iniciarSesionAdmin(driver) {
  await driver.get(url('/admin'));
  await esperarVisible(driver, '#acceso');
  await driver.findElement(By.id('acceso-correo')).sendKeys(ADMIN_EMAIL);
  await driver.findElement(By.id('acceso-clave')).sendKeys(ADMIN_PASSWORD);
  await driver.findElement(By.id('acceso-boton')).click();

  const panel = await driver.wait(async () => {
    const elemento = await driver.findElement(By.id('panel'));
    return (await elemento.isDisplayed()) ? elemento : false;
  }, WAIT_MS, 'El administrador no pudo iniciar sesión.');

  assert.equal(await panel.isDisplayed(), true);
  return panel;
}

test('la página principal abre y muestra la marca de Konys', { timeout: 60_000 }, async () => {
  await conNavegador('pagina-principal', async (driver) => {
    await driver.get(BASE_URL.toString());
    const titulo = await esperarVisible(driver, 'h1.hero__titulo');
    assert.equal((await titulo.getText()).trim(), 'Konys');
    assert.match(await driver.getTitle(), /Reserva tu mesa en Konys Pizza/i);
  });
});

test('las secciones de mesas y carta terminan de cargar sin error de conexión', { timeout: 75_000 }, async () => {
  await conNavegador('carga-mesas-y-carta', async (driver) => {
    await driver.get(BASE_URL.toString());
    await esperarVisible(driver, '#lista-mesas');
    await esperarVisible(driver, '#carta-lista');

    await driver.wait(async () => {
      const mesas = await driver.findElement(By.id('lista-mesas')).getText();
      const carta = await driver.findElement(By.id('carta-lista')).getText();
      return !mesas.includes('Cargando mesas') && !carta.includes('Cargando carta');
    }, WAIT_MS, 'Las mesas o la carta permanecieron en estado de carga.');

    const errores = await driver.findElements(By.css(
      '#lista-mesas .aviso--error, #carta-lista .aviso--error, ' +
      '#lista-mesas .aviso--info, #carta-lista .aviso--info, ' +
      '#lista-mesas [data-reintentar], #carta-lista [data-reintentar]',
    ));
    assert.equal(errores.length, 0, 'La página mostró un aviso de configuración o conexión.');

    const estadosMesas = await driver.findElements(By.css('#lista-mesas article.mesa, #lista-mesas .vacio'));
    const estadosCarta = await driver.findElements(By.css('#carta-lista article.plato, #carta-lista .vacio'));
    assert.ok(estadosMesas.length > 0, 'La sección de mesas no mostró datos ni estado vacío.');
    assert.ok(estadosCarta.length > 0, 'La sección de carta no mostró datos ni estado vacío.');
  });
});

test('el menú móvil se puede abrir y cerrar', { timeout: 60_000 }, async () => {
  await conNavegador('menu-movil', async (driver) => {
    await driver.get(BASE_URL.toString());
    await driver.manage().window().setRect({ x: 0, y: 0, width: 390, height: 844 });

    const boton = await esperarVisible(driver, '.menu-boton');
    await boton.click();
    assert.equal(await boton.getAttribute('aria-expanded'), 'true');
    assert.match(await driver.findElement(By.id('menu-principal')).getAttribute('class'), /abierto/);

    await boton.click();
    assert.equal(await boton.getAttribute('aria-expanded'), 'false');
  });
});

test('un formulario de reserva inválido no llega a confirmar una reserva', { timeout: 75_000 }, async (t) => {
  const pudoAbrirFormulario = await conNavegador('validacion-reserva-no-escribe', async (driver) => {
    await driver.get(BASE_URL.toString());
    await driver.wait(async () => {
      const texto = await driver.findElement(By.id('lista-mesas')).getText();
      return !texto.includes('Cargando mesas');
    }, WAIT_MS);

    const botonesMesa = await driver.findElements(By.css('#lista-mesas button[data-mesa]'));
    if (botonesMesa.length === 0) return false;

    await botonesMesa[0].click();
    const modal = await esperarVisible(driver, '#modal-reserva');
    assert.equal(await modal.isDisplayed(), true);

    await driver.findElement(By.id('campo-nombre')).sendKeys('A');
    await driver.findElement(By.id('campo-personas')).sendKeys('1');

    const botonConfirmar = await driver.findElement(By.id('boton-confirmar'));

    // El formulario está dentro de un modal con desplazamiento propio.
    // Desplazamos el contenedor y el botón hasta el área visible antes del clic.
    await driver.executeScript((boton) => {
      const modalCaja = boton.closest('.modal__caja');
      if (modalCaja) modalCaja.scrollTop = modalCaja.scrollHeight;
      boton.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }, botonConfirmar);

    // Evita falsos fallos por un botón oculto o cubierto por otra capa.
    await driver.wait(async () => driver.executeScript((boton) => {
      const rect = boton.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || x >= window.innerWidth || y < 0 || y >= window.innerHeight) return false;
      const elementoSuperior = document.elementFromPoint(x, y);
      return elementoSuperior === boton || boton.contains(elementoSuperior);
    }, botonConfirmar), 5_000,
    'El botón de confirmación está fuera de vista o cubierto por otro elemento.');

    await botonConfirmar.click();

    await driver.wait(async () => {
      const error = await driver.findElement(By.id('error-nombre')).getText();
      return error.includes('mínimo 2 letras');
    }, 10_000, 'No se mostró el error de validación del nombre.');

    assert.equal(await driver.findElement(By.id('confirmacion')).isDisplayed(), false);
    return true;
  });

  if (!pudoAbrirFormulario) {
    t.skip('No hay mesas disponibles en producción para abrir el formulario.');
  }
});

test('entrar a /admin con parámetros y fragmentos no muestra el panel', { timeout: 60_000 }, async () => {
  await conNavegador('acceso-admin-sin-sesion', async (driver) => {
    await driver.get(url('/admin?destino=panel&redirect=%2Fadmin#reservas'));

    const acceso = await esperarVisible(driver, '#acceso');
    const panel = await driver.findElement(By.id('panel'));
    assert.equal(await acceso.isDisplayed(), true, 'No apareció el formulario de acceso.');
    assert.equal(await panel.isDisplayed(), false, 'El panel se mostró sin una sesión autenticada.');

    const clavesAuth = await leerAlmacenamientoAuth(driver);
    assert.deepEqual(clavesAuth, [], 'Se encontró una clave de sesión Auth en localStorage/sessionStorage.');
  });
});

const opcionesSesionAdmin = {
  timeout: 90_000,
  skip: HAS_ADMIN_CREDENTIALS
    ? false
    : 'Configura E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD como secretos de GitHub para habilitar esta prueba.',
};

test('la sesión administrativa no se restaura al recargar la página', opcionesSesionAdmin, async () => {
  await conNavegador('sesion-admin-no-persiste', async (driver) => {
    await iniciarSesionAdmin(driver);
    assert.deepEqual(await leerAlmacenamientoAuth(driver), []);

    await driver.navigate().refresh();
    const acceso = await esperarVisible(driver, '#acceso');
    const panel = await driver.findElement(By.id('panel'));
    assert.equal(await acceso.isDisplayed(), true);
    assert.equal(await panel.isDisplayed(), false);
    assert.deepEqual(await leerAlmacenamientoAuth(driver), []);
  });
});

const opcionesInactividad = {
  timeout: 780_000,
  skip: !HAS_ADMIN_CREDENTIALS
    ? 'Configura las credenciales administrativas como secretos de GitHub.'
    : !RUN_SLOW_INACTIVITY
      ? 'Prueba de aproximadamente diez minutos desactivada. Activa run_full_inactivity al lanzar el workflow.'
      : false,
};

test('la actividad reinicia el plazo y cinco minutos posteriores cierran la sesión', opcionesInactividad, async () => {
  await conNavegador('cierre-por-inactividad', async (driver) => {
    await iniciarSesionAdmin(driver);

    // Deja transcurrir 4:15 sin eventos de usuario.
    await driver.sleep(255_000);

    // Este clic real debe reiniciar el contador y renovar el heartbeat.
    await driver.findElement(By.css('#panel [data-vista="mesas"]')).click();

    // Supera el vencimiento original (5:00) para demostrar que el clic reinició el plazo.
    await driver.sleep(65_000);
    const panel = await driver.findElement(By.id('panel'));
    assert.equal(await panel.isDisplayed(), true, 'La sesión expiró pese a la actividad reciente.');

    // Desde el clic de actividad, deja pasar el nuevo plazo completo.
    const acceso = await driver.wait(async () => {
      const elemento = await driver.findElement(By.id('acceso'));
      return (await elemento.isDisplayed()) ? elemento : false;
    }, 350_000, 'La sesión no se cerró después de cinco minutos sin actividad.');

    const mensaje = await driver.findElement(By.id('acceso-error')).getText();
    assert.match(mensaje, /cinco minutos de inactividad/i);
    assert.equal(await acceso.isDisplayed(), true);
    assert.equal(await panel.isDisplayed(), false);
  });
});
