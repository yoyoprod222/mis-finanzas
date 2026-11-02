// Service worker de Mis Finanzas: funciona sin conexión y avisa de vencimientos.
// Sube VERSION cada vez que cambies el HTML para que los teléfonos tomen la versión nueva.
var VERSION = 'mf-v43';
var APP = 'index.html';
var CORE = ['./', './' + APP, './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/icon.svg'];
var CDN = ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'];
// La página guarda aquí la lista de vencimientos para que el SW la lea (no tiene acceso a localStorage).
var DATA = 'mf-data', DUE = './__due.json';

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(CORE).then(function () {
      // Las librerías del PDF son opcionales: si fallan, la app se instala igual.
      return Promise.all(CDN.map(function (u) { return c.add(new Request(u, { mode: 'cors' })).catch(function () {}) }));
    });
  }).then(function () { return self.skipWaiting() }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k != VERSION && k != DATA }).map(function (k) { return caches.delete(k) }));
  }).then(function () { return self.clients.claim() }));
});

self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method != 'GET') return;
  var u = new URL(r.url);
  // La IA y los datos en vivo (clima, feriados, tránsito) nunca se guardan: siempre deben ser actuales.
  if (/openrouter\.ai|anthropic|claude\.ai|open-meteo\.com|date\.nager\.at|tomtom\.com|mapbox\.com|workers\.dev/.test(u.host)) return;
  // Lo que va con sesión (la nube) es de cada persona: nunca a la caché, que es la misma para quien use el teléfono.
  if (r.headers.has('Authorization')) return;
  // La página: primero red (para recibir cambios), si no hay conexión, la copia guardada.
  // «no-store»: GitHub Pages deja la página 10 min en la caché del navegador y, sin esto, tras publicar se seguía
  // viendo la versión anterior.
  if (r.mode == 'navigate') {
    e.respondWith(fetch(r.url, { cache: 'no-store', credentials: 'same-origin' }).then(function (res) {
      // Solo se guarda una página buena: una de error (404, 500) dejaría la app rota sin conexión.
      if (res.ok) { var cp = res.clone(); caches.open(VERSION).then(function (c) { c.put('./' + APP, cp) }) }
      return res;
    }).catch(function () {
      return caches.match(r, { ignoreSearch: true }).then(function (m) { return m || caches.match('./' + APP) });
    }));
    return;
  }
  // Resto (iconos, librerías, fuentes): copia guardada al instante y se actualiza en segundo plano.
  e.respondWith(caches.match(r).then(function (m) {
    var net = fetch(r).then(function (res) {
      if (res && (res.ok || res.type == 'opaque')) { var cp = res.clone(); caches.open(VERSION).then(function (c) { c.put(r, cp) }) }
      return res;
    }).catch(function () { return m });
    return m || net;
  }));
});

function dayDiff(d) {
  var n = new Date(), t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((new Date(d + 'T00:00') - t) / 864e5);
}
function when(n) { return n < 0 ? 'venció hace ' + (-n) + (n == -1 ? ' día' : ' días') : n == 0 ? 'vence hoy' : n == 1 ? 'vence mañana' : 'vence en ' + n + ' días' }

// Revisión en segundo plano (Chrome/Android con la app instalada): usa la última lista que guardó la página.
// Cada aviso sale una sola vez al día (se anota en SHOWN).
var SHOWN = './__shown.json';
function readJSON(c, k) { return c.match(k).then(function (r) { return r ? r.json() : null }).catch(function () { return null }) }
function checkDue() {
  var today = new Date(); today = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
  return caches.open(DATA).then(function (c) {
    return Promise.all([readJSON(c, DUE), readJSON(c, SHOWN)]).then(function (v) {
      var o = v[0], sh = v[1] && v[1].d == today ? v[1] : { d: today, k: [] };
      if (!o || !o.on || !o.items) return;
      var out = o.items.filter(function (x) { var n = dayDiff(x.date); return n <= (o.lead || 2) && n >= -3 && sh.k.indexOf(x.id) < 0 });
      return Promise.all(out.map(function (x) {
        var n = dayDiff(x.date); sh.k.push(x.id);
        return self.registration.showNotification(x.t + ' ' + when(n), {
          body: x.amt ? 'Falta pagar ' + x.amt : 'Abre Mis Finanzas para ver el detalle.',
          tag: 'mf-' + x.id, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: './' + APP + '?tab=deu' }
        });
      })).then(function () { return c.put(SHOWN, new Response(JSON.stringify(sh), { headers: { 'Content-Type': 'application/json' } })) });
    });
  }).catch(function () {});
}
self.addEventListener('periodicsync', function (e) { if (e.tag == 'mf-due') e.waitUntil(checkDue()) });
self.addEventListener('message', function (e) { if (e.data == 'check-due') e.waitUntil(checkDue()) });

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './' + APP;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ws) {
    for (var i = 0; i < ws.length; i++) if ('focus' in ws[i]) return ws[i].focus();
    return self.clients.openWindow(url);
  }));
});
