# 🔧 Deploy Strava Function — Paso a paso
## Tiempo estimado: 10 minutos

---

## ¿Por qué hace falta esto?

Strava rechaza las llamadas directas desde el navegador porque el `client_secret`
no puede estar expuesto en el HTML (seguridad CORS). Esta Cloud Function actúa
de intermediario seguro: el secret vive solo en el servidor.

---

## PASO 1 — Instalar Node.js (si no lo tenés)

Bajá el instalador de https://nodejs.org → versión LTS → instalá normalmente.

Para verificar que quedó instalado, abrí la terminal (cmd en Windows, Terminal en Mac) y escribí:
```
node --version
```
Debe mostrar algo como `v20.x.x`.

---

## PASO 2 — Instalar Firebase CLI

En la terminal:
```bash
npm install -g firebase-tools
```

Después loguearte con tu cuenta de Google:
```bash
firebase login
```
Se abre el navegador → aceptar permisos.

---

## PASO 3 — Configurar el proyecto

En la terminal, navegá a la carpeta `strava-function`:
```bash
cd ruta/a/strava-function
```

Vinculá con tu proyecto de Firebase:
```bash
firebase use TU_PROJECT_ID
```
(el `projectId` que tenés en el firebaseConfig del HTML)

---

## PASO 4 — Guardar las credenciales de Strava como secrets

```bash
firebase functions:secrets:set STRAVA_CLIENT_ID
```
→ te pide ingresar el valor → pegá tu Client ID de Strava → Enter

```bash
firebase functions:secrets:set STRAVA_CLIENT_SECRET
```
→ pegá tu Client Secret → Enter

✅ Los secrets quedan guardados en Google Secret Manager, nunca en el código.

---

## PASO 5 — Instalar dependencias y deployar

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Al terminar, te muestra las URLs de las funciones. Van a ser algo así:

```
✔ functions[stravaToken]:      https://stravatoken-XXXXX-uc.a.run.app
✔ functions[stravaActivities]: https://stravaactivities-XXXXX-uc.a.run.app
✔ functions[stravaStreams]:     https://stravastreams-XXXXX-uc.a.run.app
```

---

## PASO 6 — Copiar las URLs al HTML

Abrí `running-calendar.html` y buscá esta sección:

```javascript
const STRAVA_CLIENT_ID   = 'TU_STRAVA_CLIENT_ID';
const FUNCTIONS_BASE_URL = 'TU_FUNCTIONS_URL';
```

Reemplazá `TU_STRAVA_CLIENT_ID` con tu Client ID de Strava (solo el número,
el secret ya no va en el HTML) y `TU_FUNCTIONS_URL` con la URL base de tus
funciones, por ejemplo:

```javascript
const STRAVA_CLIENT_ID   = '123456';
const FUNCTIONS_BASE_URL = 'https://stravatoken-XXXXX-uc.a.run.app';
```

> 💡 Tip: la URL base es lo que está antes del nombre de la función.
> Buscala en Firebase Console → Functions.

---

## PASO 7 — Actualizar Strava App settings

En https://www.strava.com/settings/api:
- **Authorization Callback Domain**: tu dominio de Netlify (ej: `run-trail-vm.netlify.app`)

---

## PASO 8 — Subir el HTML actualizado a Netlify

Arrastrá el `running-calendar.html` al dashboard de Netlify como siempre.

---

## ¿Qué hace cada función?

| Función | Qué hace |
|---------|----------|
| `stravaToken` | Intercambia el código OAuth por un access token (seguro, secret en servidor) |
| `stravaActivities` | Trae la lista de actividades del atleta |
| `stravaStreams` | Trae el GPS + elevación + FC + cadencia de cada actividad |

---

## Plan gratuito de Firebase Functions

El plan **Blaze** (pay as you go) es necesario para Cloud Functions, pero en
la práctica para uso personal el costo es $0 — el free tier incluye
2 millones de invocaciones/mes gratis.

Para activarlo: Firebase Console → parte inferior izquierda → **Upgrade** → Blaze.
No hay cargo hasta que superes los límites gratuitos. Podés poner un límite de presupuesto en $1/mes para mayor seguridad.
