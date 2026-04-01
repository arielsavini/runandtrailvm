# 🏔 TrailGrid — Guía de Deployment
## Netlify (hosting gratis) + Auth0 (login con Google)

Tiempo estimado: **15–20 minutos**. Sin tocar la terminal.

---

## PASO 1 — Crear cuenta en Netlify

1. Entrá a **https://netlify.com**
2. Click en **"Sign up"** → elegí **"Sign up with GitHub"** (o con email si preferís)
3. Completá el registro

---

## PASO 2 — Subir el archivo a Netlify

1. En el dashboard de Netlify, buscá la sección que dice **"Deploy manually"** o arrastrá archivos
2. Simplemente **arrastrá el archivo `running-calendar.html`** al área de deploy
3. Netlify te da una URL automática tipo `https://random-name-123.netlify.app`
4. ✅ **¡Tu sitio ya está en línea!** (sin login con Google aún, eso viene en el paso 4)

> 💡 **Tip:** podés cambiar el nombre del sitio en Site Settings → Site details → Change site name  
> para tener algo como `trailgrid-mendoza.netlify.app`

---

## PASO 3 — Crear cuenta en Auth0 y configurar Google

### 3a. Registrarse en Auth0
1. Entrá a **https://auth0.com**
2. Click **"Sign Up"** → podés registrarte con GitHub o email
3. Cuando te pregunte por el tipo de aplicación, elegí **"Single Page Application"**
4. Nombre del tenant: podés poner `trailgrid` o lo que quieras

### 3b. Crear la aplicación
1. En el dashboard de Auth0, ir a **Applications → Applications**
2. Click **"+ Create Application"**
3. Nombre: `TrailGrid`
4. Tipo: **Single Page Application** → click **Create**

### 3c. Configurar las URLs (muy importante)
En la app recién creada, ir a la pestaña **Settings** y completar:

| Campo | Valor |
|-------|-------|
| Allowed Callback URLs | `https://TU-SITIO.netlify.app` |
| Allowed Logout URLs | `https://TU-SITIO.netlify.app` |
| Allowed Web Origins | `https://TU-SITIO.netlify.app` |

> Reemplazá `TU-SITIO` con el nombre real que te dio Netlify.  
> Scroll down → click **"Save Changes"**

### 3d. Copiar tus credenciales
En la misma pestaña Settings, anotá:
- **Domain** → algo como `dev-abc123.us.auth0.com`
- **Client ID** → cadena larga de letras y números

### 3e. Activar login con Google
1. Ir a **Authentication → Social**
2. Click en **Google / Gmail**
3. Activar el toggle (en modo desarrollo no necesitás nada más — Auth0 usa sus propias credenciales de Google para pruebas)
4. Click **Save**

---

## PASO 4 — Editar el HTML con tus credenciales

Abrí el archivo `running-calendar.html` con cualquier editor de texto (Bloc de notas, TextEdit, VS Code, etc.) y buscá estas dos líneas cerca del final del `<script>`:

```javascript
const AUTH0_DOMAIN    = 'TU-DOMINIO.auth0.com';
const AUTH0_CLIENT_ID = 'TU_CLIENT_ID_AQUI';
```

Reemplazalas con tus datos reales, por ejemplo:

```javascript
const AUTH0_DOMAIN    = 'dev-abc123.us.auth0.com';
const AUTH0_CLIENT_ID = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ123456';
```

Guardá el archivo.

---

## PASO 5 — Volver a subir el archivo actualizado a Netlify

1. En Netlify, ir a tu sitio → pestaña **"Deploys"**
2. Arrastrá nuevamente el archivo `running-calendar.html` actualizado
3. Netlify lo reemplaza automáticamente

---

## PASO 6 — Probar el login

1. Abrí tu sitio en el navegador
2. Click en **"Ingresar"** o **"Registrarse"**
3. Click en **"Continuar con Google"**
4. Se abre la ventana de Google para elegir tu cuenta
5. ✅ ¡Ya estás logueado con tu foto de perfil de Google!

---

## ¿Problemas comunes?

**"Callback URL mismatch"**  
→ Verificá que las URLs en Auth0 Settings sean exactamente iguales a tu URL de Netlify (con o sin `/` al final).

**La ventana de Google se cierra sola**  
→ Asegurate de haber guardado los cambios en Auth0 Settings.

**El sitio muestra el aviso de configuración**  
→ Las credenciales en el HTML todavía dicen `TU-DOMINIO` — revisá el Paso 4.

---

## Listo 🎉

Tu TrailGrid está en línea con login por Google, completamente gratis:
- **Netlify** — hosting gratuito ilimitado para sitios estáticos
- **Auth0** — hasta 7.500 usuarios activos/mes gratis

