const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const stravaClientId     = defineSecret("STRAVA_CLIENT_ID");
const stravaClientSecret = defineSecret("STRAVA_CLIENT_SECRET");

// ── Token exchange ────────────────────────────────────────────────────────────
exports.stravaToken = onRequest(
  { secrets: [stravaClientId, stravaClientSecret], cors: true },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.set("Access-Control-Allow-Headers","Content-Type"); res.status(204).send(""); return; }

    const { code, grant_type, refresh_token } = req.body;
    try {
      const body = {
        client_id:     stravaClientId.value(),
        client_secret: stravaClientSecret.value(),
        grant_type:    grant_type || "authorization_code",
      };
      if (grant_type === "refresh_token") body.refresh_token = refresh_token;
      else body.code = code;

      const r    = await fetch("https://www.strava.com/oauth/token", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
      const data = await r.json();
      if (data.errors) { res.status(400).json({ error: data.message }); return; }
      res.json(data);
    } catch(e) { res.status(500).json({ error: e.message }); }
  }
);

// ── Activities list ───────────────────────────────────────────────────────────
exports.stravaActivities = onRequest({ cors: true }, async (req, res) => {
  res.set("Access-Control-Allow-Origin","*");
  if (req.method==="OPTIONS"){ res.set("Access-Control-Allow-Headers","Content-Type,Authorization"); res.status(204).send(""); return; }
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
