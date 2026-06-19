// Generic NSE proxy for Scanner_B3 — fetches NSE data server-side (where
// CORS doesn't apply) and returns it with permissive CORS headers so the
// static HTML file can call this instead of unreliable third-party proxies.
//
// Usage from the app:
//   https://YOUR-PROJECT.vercel.app/api/nse-proxy?url=<encoded target URL>
//
// Handles both NSE endpoints the app needs:
//   https://www.nseindia.com/api/allIndices                          (live prices, JSON)
//   https://archives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv  (historical closes, CSV)
//
// NSE actively blocks bare server-to-server requests that don't look like a
// real browser session. The fix NSE scraping guides consistently document:
// first hit nseindia.com itself to receive session cookies, then reuse
// those exact cookies on the real API/archive request.

const ALLOWED_HOSTS = ['www.nseindia.com', 'archives.nseindia.com'];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const target = req.query.url;
  if (!target) {
    res.status(400).json({ error: 'Missing ?url= parameter' });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    res.status(400).json({ error: 'Invalid url parameter' });
    return;
  }

  if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    // Deliberately restrictive — this proxy is only meant for NSE, not as
    // an open relay for arbitrary URLs.
    res.status(403).json({ error: 'Host not allowed: ' + targetUrl.hostname });
    return;
  }

  try {
    // Step 1: prime a session by hitting the NSE homepage first, capturing
    // whatever cookies it sets. Without this, NSE's API/archive endpoints
    // frequently return 401/403 even with a normal browser User-Agent.
    let cookieHeader = '';
    try {
      const primeRes = await fetch('https://www.nseindia.com/', {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      const setCookie = primeRes.headers.get('set-cookie');
      if (setCookie) {
        // Multiple Set-Cookie headers may be combined by the runtime into
        // one string separated by commas in some environments; split
        // defensively and keep just the name=value pairs.
        cookieHeader = setCookie
          .split(/,(?=\s*[A-Za-z0-9_\-]+=)/)
          .map(c => c.split(';')[0].trim())
          .join('; ');
      }
    } catch (_) {
      // If priming fails, still attempt the real request — some NSE
      // endpoints work without it some of the time.
    }

    // Step 2: the real request, with primed cookies attached.
    const realRes = await fetch(targetUrl.toString(), {
      headers: {
        ...BROWSER_HEADERS,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        'Referer': 'https://www.nseindia.com/',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!realRes.ok) {
      res.status(realRes.status).json({
        error: 'NSE responded with HTTP ' + realRes.status,
        primed: !!cookieHeader,
      });
      return;
    }

    const contentType = realRes.headers.get('content-type') || '';
    res.setHeader('Cache-Control', 'public, max-age=120'); // small cache, NSE data changes slowly outside market hours

    if (contentType.includes('json')) {
      const data = await realRes.json();
      res.status(200).json(data);
    } else {
      // CSV / text responses (the historical archive files) — pass through
      // as plain text, exactly as the app's existing CSV parser expects.
      const text = await realRes.text();
      res.setHeader('Content-Type', 'text/csv');
      res.status(200).send(text);
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Proxy request failed' });
  }
}
