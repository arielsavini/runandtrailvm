# 🔥 RUN & TRAIL VM — Guía de configuración Firebase
## Base de datos en la nube (gratis) + Fotos sincronizadas

Con Firebase, todos los dispositivos ven los mismos datos en tiempo real.
Tiempo estimado: **20 minutos**.

---

## PASO 1 — Crear proyecto en Firebase

1. Ir a **https://console.firebase.google.com**
2. Click **"Agregar proyecto"**
3. Nombre: `run-trail-vm` (o el que quieras)
4. Desactivar Google Analytics (no es necesario) → **Crear proyecto**

---

## PASO 2 — Registrar tu app web

1. En el dashboard del proyecto, click en el ícono **`</>`** (Web)
2. Nombre de la app: `run-trail-vm`
3. **NO** marcar "Firebase Hosting" (ya usamos Netlify)
4. Click **"Registrar app"**
5. Aparece un bloque de código con `firebaseConfig` — **copiá estos 6 valores**:

```javascript
const firebaseConfig = {
  apiKey:            "AIzaSy...",          ← copiá esto
  authDomain:        "run-trail-vm.firebaseapp.com",
  projectId:         "run-trail-vm",
  storageBucket:     "run-trail-vm.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123...:web:abc..."
};
```

---

## PASO 3 — Activar Firestore (base de datos)

1. En el menú izquierdo → **Firestore Database**
2. Click **"Crear base de datos"**
3. Elegir **"Modo de prueba"** (permite leer/escribir sin autenticación por 30 días)
4. Región: `southamerica-east1` (São Paulo, la más cercana)
5. Click **"Listo"**

### Reglas de seguridad (después de los 30 días o para producción)
En Firestore → pestaña **Reglas**, reemplazá con:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Cualquiera puede leer carreras
    match /races/{raceId} {
      allow read: true;
      // Solo escritura si está autenticado (cuando uses Auth0 + Firebase Auth)
      allow write: if request.auth != null;
    }
  }
}
```

---

## PASO 4 — Activar Storage (fotos)

1. En el menú izquierdo → **Storage**
2. Click **"Comenzar"**
3. Elegir **"Modo de prueba"**
4. Misma región: `southamerica-east1`
5. Click **"Listo"**

---

## PASO 5 — Pegar las credenciales en el HTML

Abrí `running-calendar.html` con un editor de texto y buscá esta sección:

```javascript
const firebaseConfig = {
  apiKey:            "TU_API_KEY",
  authDomain:        "TU_PROJECT.firebaseapp.com",
  projectId:         "TU_PROJECT_ID",
  storageBucket:     "TU_PROJECT.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId:             "TU_APP_ID"
};
```

Reemplazá cada valor con los que copiaste en el Paso 2.

También actualizá tu email de administrador:
```javascript
const ADMIN_EMAIL = 'tuemail@gmail.com'; // ← tu email de Google
```

---

## PASO 6 — Subir a Netlify

1. Guardá el archivo HTML
2. Arrastrá el archivo a **Netlify** (pestaña Deploys de tu sitio)
3. ¡Listo! Los datos ahora se sincronizan en todos los dispositivos

---

## PASO 7 — Verificar que funciona

1. Abrí tu sitio en **Chrome** (dispositivo 1)
2. Logeate como admin y agregá una carrera
3. Abrí el sitio en **otro navegador o celular** (dispositivo 2)
4. ✅ La carrera aparece instantáneamente sin recargar

---

## Cómo funciona (resumen técnico)

| Qué | Dónde se guarda |
|-----|----------------|
| Datos de carreras (nombre, fecha, etc.) | Firebase Firestore |
| Fotos de portada y participaciones | Firebase Storage |
| Usuario logueado | sessionStorage (solo local, no viaja) |
| Nada | localStorage (ya no se usa) |

El listener `onSnapshot` de Firestore mantiene la página sincronizada en tiempo real — si el admin edita una carrera, todos los usuarios conectados la ven actualizada en segundos sin recargar.

---

## Plan gratuito de Firebase (Spark)

| Recurso | Límite gratis |
|---------|--------------|
| Lecturas Firestore | 50.000 / día |
| Escrituras Firestore | 20.000 / día |
| Storage | 5 GB total |
| Transferencia Storage | 1 GB / día |

Más que suficiente para una comunidad de running regional.

---

## Problemas comunes

**"Missing or insufficient permissions"**
→ Firestore está en modo producción. Revisá las reglas (Paso 3).

**Las fotos no se suben**
→ Storage no está activado o las reglas bloquean. Revisá el Paso 4.

**Los datos se ven pero no en tiempo real**
→ Normal si el `apiKey` es incorrecto. Verificá que copiaste todos los campos.
