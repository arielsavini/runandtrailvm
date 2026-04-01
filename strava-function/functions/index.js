const functions    = require("firebase-functions");            // Gen 1 (sin Cloud Build)
const { onRequest } = require("firebase-functions/v2/https"); // Gen 2 (para activities y streams)
const admin   = require("firebase-admin");
const webPush = require("web-push");

// Inicializar Firebase Admin (una sola vez)
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ── Token exchange (Gen 1 — evita Cloud Build) ───────────────────────────────
exports.stravaAuth = functions.https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.set("Access-Control-Allow-Headers","Content-Type"); res.status(204).send(""); return; }

    const { code, grant_type, refresh_token } = req.body;
    try {
      const body = {
        client_id:     process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type:    grant_type || "authorization_code",
      };
      if (grant_type === "refresh_token") body.refresh_token = refresh_token;
      else body.code = code;

      const r    = await fetch("https://www.strava.com/oauth/token", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
      const data = await r.json();
      if (data.errors) { res.status(400).json({ error: data.message }); return; }
      res.json(data);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Activities list  +  Token exchange (comparte el mismo endpoint) ──────────
exports.stravaActivities = onRequest({ cors: true }, async (req, res) => {
  res.set("Access-Control-Allow-Origin","*");
  if (req.method==="OPTIONS"){ res.set("Access-Control-Allow-Headers","Content-Type,Authorization"); res.status(204).send(""); return; }

  // ── Token exchange: POST con grant_type ──────────────────────────────────
  if (req.method === "POST" && (req.body?.grant_type || req.body?.code)) {
    const { code, grant_type, refresh_token } = req.body;
    try {
      const body = {
        client_id:     process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type:    grant_type || "authorization_code",
      };
      if (grant_type === "refresh_token") body.refresh_token = refresh_token;
      else body.code = code;
      const r    = await fetch("https://www.strava.com/oauth/token", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
      const data = await r.json();
      if (data.errors) { res.status(400).json({ error: data.message }); return; }
      res.json(data);
    } catch(e) { res.status(500).json({ error: e.message }); }
    return;
  }

  // ── Activities list ───────────────────────────────────────────────────────
  const token = req.query.token || req.headers.authorization?.replace("Bearer ","");
  const page  = req.query.page  || 1;
  if (!token) { res.status(401).json({error:"Token requerido"}); return; }
  try {
    const r    = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=50&page=${page}`, { headers:{Authorization:`Bearer ${token}`} });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Activity streams (GPS + elevation + HR + cadence) ────────────────────────
exports.stravaStreams = onRequest({ cors: true }, async (req, res) => {
  res.set("Access-Control-Allow-Origin","*");
  if (req.method==="OPTIONS"){ res.set("Access-Control-Allow-Headers","Content-Type,Authorization"); res.status(204).send(""); return; }
  const token      = req.query.token || req.headers.authorization?.replace("Bearer ","");
  const activityId = req.query.activityId;
  if (!token||!activityId){ res.status(400).json({error:"Faltan parámetros"}); return; }
  try {
    const r    = await fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=latlng,altitude,heartrate,cadence&key_by_type=true`,{ headers:{Authorization:`Bearer ${token}`} });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Recordatorio semanal de carreras (HTTP — llamar con ?secret=...) ─────────
// Podés configurar Cloud Scheduler en GCP para llamarlo automáticamente
// o llamarlo manualmente desde el admin para probar notificaciones push
exports.triggerReminders = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.set("Access-Control-Allow-Headers","Content-Type"); res.status(204).send(""); return; }

  // Protección básica: requiere header o param secret
  const secret = req.headers["x-admin-secret"] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail   = process.env.VAPID_EMAIL || "mailto:arielsavini@gmail.com";

  if (!vapidPublic || !vapidPrivate) {
    res.status(500).json({ error: "VAPID keys no configuradas" }); return;
  }

  webPush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

  // Fecha objetivo: hoy + 7 días en formato YYYY-MM-DD
  const target = new Date();
  target.setDate(target.getDate() + 7);
  const targetStr = target.toISOString().split("T")[0]; // "YYYY-MM-DD"

  // Buscar carreras que ocurren exactamente en 7 días
  const racesSnap = await db.collection("races")
    .where("date", "==", targetStr)
    .get();

  if (racesSnap.empty) {
    res.json({ sent: 0, message: `No hay carreras el ${targetStr}` }); return;
  }

  // Obtener todas las suscripciones push activas
  const subsSnap = await db.collection("push_subscriptions").get();
  if (subsSnap.empty) {
    res.json({ sent: 0, message: "No hay suscripciones push registradas" }); return;
  }

  // Para cada carrera, enviar notificación a todos los suscriptos
  const races = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const subs  = subsSnap.docs.map(d => d.data().subscription);

  const promises = [];
  for (const race of races) {
    const payload = JSON.stringify({
      title:   `🏃 Falta 1 semana — ${race.name}`,
      body:    `El ${targetStr.split("-").reverse().join("/")}${race.provincia ? " · " + race.provincia : ""}. ¡Preparate!`,
      url:     "./index.html",
      tag:     `race-reminder-${race.id}`,
    });
    for (const sub of subs) {
      promises.push(
        webPush.sendNotification(sub, payload).catch(err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            const expired = subsSnap.docs.find(d => JSON.stringify(d.data().subscription) === JSON.stringify(sub));
            if (expired) return expired.ref.delete();
          }
          console.error("Error enviando push:", err.statusCode);
        })
      );
    }
  }

  await Promise.allSettled(promises);
  const msg = `Recordatorios enviados para ${races.length} carrera(s) y ${subs.length} suscripción(es)`;
  console.log(msg);
  res.json({ sent: subs.length * races.length, message: msg });
});
