# Boca Monitor

Bot de monitoreo con Node.js + Playwright para vigilar `https://bocasocios.bocajuniors.com.ar/matches`, entrar al partido cuando se habilite y avisarte con un sonido para que completes manualmente la compra.

## Requisitos

- Node.js 18 o superior
- npm

## Instalación

```bash
npm install
npx playwright install chromium
```

## Configuración

1. Copiá `.env.example` a `.env`
2. Ajustá las variables necesarias

### Configuración mínima

```env
MATCHES_URL=https://bocasocios.bocajuniors.com.ar/matches
CHECK_INTERVAL_MS=2500
HEADLESS=false
USER_DATA_DIR=./user_data
SOUND_ALERT=true
```

### Opcional: filtrar por texto de partido

```env
TARGET_MATCH_TEXT=Boca vs Benfica
```

## Ejecutar

```bash
npm start
```

## Primer uso

1. Se abrirá una ventana del navegador
2. Si la web pide login, hacelo manualmente
3. El bot reutilizará esa sesión en los próximos arranques gracias a `USER_DATA_DIR`

## Aviso por sonido

Si `SOUND_ALERT=true`, el bot hace sonar la terminal cuando:

- detecta login correcto
- entra al partido
- ocurre un error importante

## Notificaciones opcionales

### WhatsApp Cloud API

```env
WHATSAPP_ENABLED=true
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_TO=54911XXXXXXXX
```

### Telegram

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Depuración

```bash
npm run codegen
```

## Limitaciones

- No resuelve CAPTCHA automáticamente
- No evita mecanismos anti-bot
- Si la página cambia mucho, hay que actualizar selectores
- El flujo final queda manual
