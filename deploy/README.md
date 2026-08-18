# Despliegue

## systemd (recomendado)

```bash
sudo useradd --system --home /opt/spotifymarket --shell /usr/sbin/nologin spotifymarket
sudo chown -R spotifymarket:spotifymarket /opt/spotifymarket
sudo cp deploy/spotifymarket.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spotifymarket
sudo systemctl status spotifymarket
```

Recargar la configuración sin reiniciar el proceso:

```bash
sudo systemctl reload spotifymarket   # manda SIGHUP y el bot relee config/
```

## Chromium

El tablón de stock (`utils/sellAuthStockArtwork.js`) renderiza HTML con un
Chromium headless. No es una dependencia de npm: hay que instalarla en la
máquina.

```bash
sudo apt-get install -y chromium        # o chromium-browser / google-chrome-stable
```

Si el binario está en otra ruta, defínela en el `.env` con `CHROMIUM_PATH`.
Sin Chromium el resto del bot funciona: solo se desactiva el tablón de stock.

## Vigilancia

Dos variables de entorno opcionales, ambas muy recomendables:

| Variable | Para qué |
|---|---|
| `ALERT_WEBHOOK_URL` | Webhook de Discord a un canal privado de staff. Recibe caídas, arranques degradados y reinicios del watchdog. |
| `HEALTHCHECK_URL` | URL de un monitor externo (healthchecks.io, Uptime Kuma). El bot hace ping cada minuto; **la ausencia de ping es lo único que detecta que el proceso murió del todo.** |

El bot expone además `GET http://127.0.0.1:8787/health` sin token, que devuelve
200 cuando Discord y todos los subsistemas están operativos y 503 si no.

## Comprobación antes de desplegar

```bash
npm ci
npm test
```
