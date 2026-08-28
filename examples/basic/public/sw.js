const CACHE_PREFIX = "regular-sync-app-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;
self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([cacheBuild(), self.skipWaiting()]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([deleteOldCaches(), self.clients.claim()]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirstAsset(request));
  }
});

async function cacheBuild() {
  const response = await fetch("/asset-manifest.json", { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Could not load the asset manifest");
  }

  const manifest = await response.json();
  const urls = ["/"];

  for (const entry of Object.values(manifest)) {
    urls.push(entry.file, ...(entry.css ?? []), ...(entry.assets ?? []));
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(urls);
}

async function deleteOldCaches() {
  const names = await caches.keys();

  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)),
  );
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);

    if (response.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match(new URL("/", self.location.origin).href)) ??
      Response.error()
    );
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);

  if (response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
}
