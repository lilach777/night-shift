// Vercel serverless function: GET /api/turn -> short-lived Cloudflare TURN credentials for the game's
// WebRTC connections (multiplayer data + voice). Browsers use the relay only when a direct connection
// between players is impossible (strict NAT, mobile networks, some Wi-Fi).
//
// Server-side environment variables (Vercel project settings - never VITE_*, never in the repository):
//   CLOUDFLARE_TURN_KEY_ID      the TURN key's id     (Cloudflare dashboard -> Realtime -> TURN Server)
//   CLOUDFLARE_TURN_API_TOKEN   that key's API token  (a long-term secret: it stays on this server)
// Without them the endpoint answers 503 and the game falls back to direct connections only.
//
// The response holds only temporary credentials (TTL below) - never the key or the token.
const TTL = 6 * 3600;   // seconds; longer than a night of play, short enough to limit reuse elsewhere
const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method not allowed' }); }

  // only the game's own pages (or the URL opened directly): browsers mark requests from other sites
  const site = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  if ((site && site !== 'same-origin' && site !== 'none') || (origin && safeHost(origin) !== req.headers.host)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return res.status(503).json({ error: 'relay not configured' });

  try {
    const r = await fetch(`${API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return res.status(502).json({ error: 'relay provider error' });   // status only: never echo the provider's body
    const data = await r.json();
    const iceServers = [].concat(data.iceServers || [])
      .map(s => ({ ...s, urls: [].concat(s.urls || []).filter(u => typeof u === 'string' && !/:53(\?|$)/.test(u)) }))   // browsers block port 53
      .filter(s => s.urls.length);
    if (!iceServers.length) return res.status(502).json({ error: 'relay provider error' });
    return res.status(200).json({ iceServers, ttl: TTL });
  } catch {
    return res.status(502).json({ error: 'relay provider unreachable' });
  }
}

function safeHost(u) { try { return new URL(u).host; } catch { return null; } }
