/* =====================================================================
   Service worker — Career Mode / Trading Psychology Trainer
   ---------------------------------------------------------------------
   STRATEGY (chosen by simulation, see the app's Master TOC entry 15O):
   - App shell (index.html + assets): NETWORK-FIRST, falling back to cache.
     Cache-first would strand installed users on an old build forever after
     a fix (this app is patched often). Network-first always shows the latest
     when online and still opens offline from the last good copy.
   - Only same-origin GET requests are ever handled. Nothing else is touched,
     so a future feature that talks to another server cannot be broken by this file.
   - Game progress lives in localStorage (see Persistence in the app), NOT in this
     cache, so clearing/updating the cache can never delete a saved career.
   BUMP `VERSION` whenever a shell file changes so old caches are purged.
   ===================================================================== */
const VERSION = "tpt-v1";
const SHELL = [
  "./",                       // some hosts serve index.html at "/"
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

// Pre-cache the shell. One missing file must not block installation of the rest, so each is added
// individually and failures are swallowed (the file will simply be cached on first successful fetch).
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)))
    )
  );
  // NOTE: no self.skipWaiting() here on purpose. The page decides when to activate a waiting worker
  // (see the update banner), so a new version never swaps in underneath a career in progress.
});

// Delete caches from older versions so storage does not grow without bound.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page posts {type:"SKIP_WAITING"} when the player taps "Update" in the banner.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                                  // never touch POST/PUT etc.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                   // never touch cross-origin requests

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache only complete, successful, same-origin responses (skip opaque/partial/error ones).
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        // Offline: exact match first; for page navigations fall back to the cached app shell so
        // opening the installed app with no signal still works.
        caches.match(req).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined) ||
          new Response("Offline and not cached yet.", { status: 503, headers: { "Content-Type": "text/plain" } })
        )
      )
  );
});
