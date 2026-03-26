# Deploy del Cloudflare Worker (intercambio token Strava)

## ¿Por qué?
GitHub Pages es hosting estático — no puede guardar el `client_secret` de Strava con seguridad.
El Worker actúa de proxy seguro: recibe el `code` OAuth, hace el intercambio con Strava y devuelve el token.

## 1. Instalar Wrangler (una sola vez)

```bash
npm install -g wrangler
```

## 2. Autenticarse en Cloudflare

```bash
npx wrangler login
```
Se abre el navegador → autorizar → listo.

## 3. Desplegar el Worker

```bash
cd cloudflare-worker
npx wrangler deploy
```

Al terminar verás la URL del Worker, algo como:
```
https://strava-auth.TU_SUBDOMINIO.workers.dev
```

## 4. Cargar los secrets (¡nunca escribirlos en el código!)

```bash
npx wrangler secret put STRAVA_CLIENT_ID
# ingresá: 213897

npx wrangler secret put STRAVA_CLIENT_SECRET
# ingresá: 9381b85c892362ada87c9051fed4ebe6c8f0d929
```

## 5. Actualizar index.html

En `index.html`, línea ~1630, reemplazá `TU_SUBDOMINIO` con el subdominio real:

```javascript
const STRAVA_AUTH_URL = 'https://strava-auth.TU_SUBDOMINIO.workers.dev';
//                                              ↑ esto lo ves al hacer wrangler deploy
```

## 6. Configurar Strava App

En https://www.strava.com/settings/api → **Authorization Callback Domain** →
ponés tu dominio de GitHub Pages, por ejemplo: `tuusuario.github.io`

## Resumen de URLs en index.html

| Variable | Valor | Propósito |
|---|---|---|
| `STRAVA_AUTH_URL` | `https://strava-auth.TU_SUBDOMINIO.workers.dev` | Token exchange (Cloudflare) |
| `FUNCTIONS_BASE_URL` | `https://us-central1-run-trail-vm.cloudfunctions.net` | API de actividades (Firebase) |
