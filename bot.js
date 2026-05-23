require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');

const CONFIG = {
  MATCHES_URL: process.env.MATCHES_URL || 'https://bocasocios.bocajuniors.com.ar/matches',
  CHECK_INTERVAL_MS: Number(process.env.CHECK_INTERVAL_MS || 2500),
  DEFAULT_TIMEOUT_MS: Number(process.env.DEFAULT_TIMEOUT_MS || 15000),
  USER_DATA_DIR: process.env.USER_DATA_DIR || './user_data',
  TARGET_MATCH_TEXT: (process.env.TARGET_MATCH_TEXT || '').trim(),
  WHATSAPP_ENABLED: String(process.env.WHATSAPP_ENABLED).toLowerCase() === 'true',
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || '',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  WHATSAPP_TO: process.env.WHATSAPP_TO || '',
  TELEGRAM_ENABLED: String(process.env.TELEGRAM_ENABLED).toLowerCase() === 'true',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  HEADLESS: String(process.env.HEADLESS).toLowerCase() === 'true',
  SCREENSHOT_ON_ENTER: String(process.env.SCREENSHOT_ON_ENTER).toLowerCase() === 'true',
  SOUND_ALERT: String(process.env.SOUND_ALERT || 'true').toLowerCase() === 'true'
};

let hasEnteredMatch = false;
let lastNotifiedKey = null;

function log(...args) {
  console.log(new Date().toISOString(), '-', ...args);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function beep(times = 3) {
  if (!CONFIG.SOUND_ALERT) return;
  for (let i = 0; i < times; i++) {
    process.stdout.write('\x07');
  }
}

async function sendWhatsApp(text) {
  if (!CONFIG.WHATSAPP_ENABLED) return false;
  if (!CONFIG.WHATSAPP_TOKEN || !CONFIG.WHATSAPP_PHONE_NUMBER_ID || !CONFIG.WHATSAPP_TO) {
    log('WhatsApp no configurado completamente.');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${CONFIG.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: CONFIG.WHATSAPP_TO,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    return true;
  } catch (err) {
    log('Error enviando WhatsApp:', err.response?.data || err.message);
    return false;
  }
}

async function sendTelegram(text) {
  if (!CONFIG.TELEGRAM_ENABLED) return false;
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    log('Telegram no configurado completamente.');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(
      url,
      {
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text
      },
      { timeout: 15000 }
    );
    return true;
  } catch (err) {
    log('Error enviando Telegram:', err.response?.data || err.message);
    return false;
  }
}

async function notify(text, dedupeKey = null) {
  if (dedupeKey && lastNotifiedKey === dedupeKey) return;

  log('NOTIFY:', text);
  beep(5);

  const [wa, tg] = await Promise.all([
    sendWhatsApp(text),
    sendTelegram(text)
  ]);

  if (!wa && !tg) {
    log('Sin canal de notificación remoto activo. Aviso por consola/sonido.');
  }

  if (dedupeKey) {
    lastNotifiedKey = dedupeKey;
  }
}

async function safeText(locator) {
  try {
    const t = await locator.innerText({ timeout: 1000 });
    return (t || '').trim();
  } catch {
    return '';
  }
}

async function isVisible(locator) {
  try {
    return await locator.isVisible({ timeout: 1000 });
  } catch {
    return false;
  }
}

async function exists(locator) {
  try {
    return (await locator.count()) > 0;
  } catch {
    return false;
  }
}

async function takeScreenshot(page, namePrefix = 'screenshot') {
  if (!CONFIG.SCREENSHOT_ON_ENTER) return null;
  ensureDir('./screenshots');
  const file = path.join('./screenshots', `${namePrefix}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log('Screenshot guardado en', file);
  return file;
}

async function findCandidateMatch(page) {
  if (CONFIG.TARGET_MATCH_TEXT) {
    const target = CONFIG.TARGET_MATCH_TEXT.toLowerCase();

    const candidates = page.locator('a, button, [role="button"], .card, [class*="card"], [class*="match"], [class*="fixture"]');
    const count = await candidates.count();

    for (let i = 0; i < count; i++) {
      const el = candidates.nth(i);
      const text = (await safeText(el)).toLowerCase();
      if (!text) continue;

      if (text.includes(target)) {
        return {
          locator: el,
          reason: `match_text:${CONFIG.TARGET_MATCH_TEXT}`,
          text
        };
      }
    }
  }

  const textSelectors = [
    'a:has-text("Comprar")',
    'button:has-text("Comprar")',
    'a:has-text("Ingresar")',
    'button:has-text("Ingresar")',
    'a:has-text("Disponible")',
    'button:has-text("Disponible")',
    'a:has-text("Seleccionar")',
    'button:has-text("Seleccionar")',
    'a:has-text("Adquirir")',
    'button:has-text("Adquirir")',
    'a:has-text("Ver más")',
    'button:has-text("Ver más")'
  ];

  for (const selector of textSelectors) {
    const loc = page.locator(selector);
    if (await exists(loc) && await isVisible(loc.first())) {
      return {
        locator: loc.first(),
        reason: `selector:${selector}`,
        text: await safeText(loc.first())
      };
    }
  }

  const links = page.locator('a[href*="/matches/"]');
  const linkCount = await links.count();
  for (let i = 0; i < linkCount; i++) {
    const link = links.nth(i);
    if (await isVisible(link)) {
      const href = await link.getAttribute('href');
      if (href && href !== '/matches') {
        const text = await safeText(link);
        return {
          locator: link,
          reason: `href:${href}`,
          text
        };
      }
    }
  }

  return null;
}

async function confirmInsideMatch(page) {
  try {
    await Promise.race([
      page.waitForURL(/\/matches\/.+/i, { timeout: 7000 }),
      page.waitForSelector('button, a', { timeout: 7000 })
    ]);
  } catch {}

  const bodyText = await safeText(page.locator('body'));
  const clues = ['comprar', 'continuar', 'seleccionar', 'platea', 'popular', 'ticket', 'entrada'];
  const matched = clues.filter(c => bodyText.toLowerCase().includes(c));

  return {
    inside: matched.length > 0 || /\/matches\/.+/i.test(page.url()),
    clues: matched,
    url: page.url()
  };
}

async function waitForManualLogin(page) {
  log('Verificando si hace falta login...');

  await page.goto(CONFIG.MATCHES_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  const currentUrl = page.url().toLowerCase();
  const body = (await safeText(page.locator('body'))).toLowerCase();

  const loginSignals = [
    'iniciar sesión',
    'iniciar sesion',
    'login',
    'correo',
    'contraseña',
    'contrasena',
    'email'
  ];

  const needsLogin = loginSignals.some(s => body.includes(s)) || currentUrl.includes('login');

  if (!needsLogin) {
    log('Sesión aparentemente activa.');
    return;
  }

  log('Parece que hace falta iniciar sesión.');
  log('Hacé login manual en la ventana del navegador. Espero hasta 3 minutos...');

  const deadline = Date.now() + 3 * 60 * 1000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const url = page.url().toLowerCase();
    const bodyNow = (await safeText(page.locator('body'))).toLowerCase();
    const stillNeedsLogin = loginSignals.some(s => bodyNow.includes(s)) || url.includes('login');

    if (!stillNeedsLogin) {
      log('Login detectado correctamente.');
      await notify('✅ Login detectado. El bot quedó monitoreando partidos.', 'login-ok');
      return;
    }
  }

  throw new Error('No se completó el login manual dentro del tiempo esperado.');
}

async function monitor(page) {
  log('Iniciando monitoreo sobre', CONFIG.MATCHES_URL);

  while (true) {
    try {
      if (hasEnteredMatch) {
        log('Ya se ingresó a un partido. Mantengo la página abierta para acción manual.');
        await page.waitForTimeout(5000);
        continue;
      }

      await page.goto(CONFIG.MATCHES_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1500);

      const candidate = await findCandidateMatch(page);

      if (!candidate) {
        log('No se detectó partido habilitado todavía.');
        await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        continue;
      }

      log('Candidato detectado:', candidate.reason, '| texto:', candidate.text || '(sin texto)');

      try {
        await candidate.locator.click({ timeout: 5000 });
      } catch (err) {
        log('Falló click directo al candidato, intento force click:', err.message);
        try {
          await candidate.locator.click({ timeout: 5000, force: true });
        } catch (err2) {
          log('También falló force click:', err2.message);
          await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
          continue;
        }
      }

      await page.waitForTimeout(2000);
      const result = await confirmInsideMatch(page);

      if (result.inside) {
        hasEnteredMatch = true;
        const shot = await takeScreenshot(page, 'entered-match');

        await notify(
          `🎟️ Entré al partido.\nURL: ${result.url}\nPistas: ${result.clues.join(', ') || 'sin pistas'}${shot ? '\nSe guardó screenshot local.' : ''}\nRevisá ahora para completar manualmente.`,
          'entered-match'
        );

        log('Ingreso detectado. URL actual:', result.url);
      } else {
        log('Se hizo click pero no parece haber entrado a un detalle útil. Reintento monitoreo.');
      }

      await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
    } catch (err) {
      log('Error en ciclo de monitoreo:', err.message);
      await notify(`⚠️ Error en monitoreo: ${err.message}`, `error:${err.message}`);
      await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
    }
  }
}

(async () => {
  ensureDir(CONFIG.USER_DATA_DIR);

  const context = await chromium.launchPersistentContext(CONFIG.USER_DATA_DIR, {
    headless: CONFIG.HEADLESS,
    viewport: { width: 1440, height: 900 }
  });

  context.setDefaultTimeout(CONFIG.DEFAULT_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(45000);

  const page = context.pages()[0] || await context.newPage();

  page.on('dialog', async (dialog) => {
    log('Dialog detectado:', dialog.message());
    await dialog.dismiss().catch(() => {});
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      log('Navegó a:', frame.url());
    }
  });

  process.on('SIGINT', async () => {
    log('Cerrando por SIGINT...');
    await context.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log('Cerrando por SIGTERM...');
    await context.close();
    process.exit(0);
  });

  try {
    await waitForManualLogin(page);
    await monitor(page);
  } catch (err) {
    log('Error fatal:', err.message);
    await notify(`❌ Error fatal del bot: ${err.message}`, 'fatal');
    await context.close();
    process.exit(1);
  }
})();
