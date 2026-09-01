// Ginga Service Worker v20260901-3
const CACHE="ginga-shell-v048-packfix-20260901";
const SHELL=["/","/favicon.svg","/ginga-mark.png"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>undefined));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("ginga-shell-")&&key!==CACHE).map(key=>caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;
  if(url.pathname.startsWith("/api/")||url.pathname.startsWith("/updates/")||url.pathname.startsWith("/socket.io/")) return;

  // Somente navegacao usa fallback offline. Assets seguem o cache HTTP normal do navegador.
  // Isso evita Response.clone() em respostas ja consumidas e reduz regressao por asset antigo.
  if(request.mode==="navigate") {
    event.respondWith(fetch(request).catch(()=>caches.match("/")).then(response=>response||Response.error()));
  }
});
