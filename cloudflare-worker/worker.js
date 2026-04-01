/**
 * Cloudflare Worker — Strava OAuth token exchange
 *
 * Deploy:
 *   1. cd cloudflare-worker
 *   2. npx wrangler deploy
 *   3. npx wrangler secret put STRAVA_CLIENT_ID     → ingresá: 213897
 *   4. npx wrangler secret put STRAVA_CLIENT_SECRET → ingresá: (tu client secret)
 *
 * La URL del Worker quedará en:
 *   https://strava-auth.<tu-subdominio>.workers.dev
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: corsHeaders,
      });
    }

    try {
      const { code, grant_type, refresh_token } = await request.json();

      const body = {
        client_id:     env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        grant_type:    grant_type || 'authorization_code',
      };
      if (grant_type === 'refresh_token') body.refresh_token = refresh_token;
      else body.code = code;

      const stravaRes = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await stravaRes.json();

      if (data.errors) {
        return new Response(JSON.stringify({ error: data.message }), {
          status: 400, headers: corsHeaders,
        });
      }
      return new Response(JSON.stringify(data), {
        status: 200, headers: corsHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: corsHeaders,
      });
    }
  },
};
