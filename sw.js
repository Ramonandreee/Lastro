/* ════════════════════════════════════════════════════════════
   Lastro · Service Worker
   Objetivo enxuto: entregar notificações de alerta ricas (com
   botões de ação e vibração) e abrir o ativo ao tocar.
   NÃO faz cache de fetch de propósito — assim o app nunca serve
   um index.html desatualizado (bug clássico de PWA).
   ════════════════════════════════════════════════════════════ */
const VERSION = 'lastro-sw-v1';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

/* clique na notificação → foca o app aberto (e navega) ou abre uma nova aba no ativo */
self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  if (event.action === 'dismiss') return;
  const tk = (n.data && n.data.tk) ? String(n.data.tk) : '';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        if (tk) c.postMessage({ type: 'open-asset', tk });
        return;
      }
    }
    const url = tk ? `/?asset=${encodeURIComponent(tk)}` : '/';
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

/* ponto de extensão futuro: Web Push real (app fechado) entraria aqui
   self.addEventListener('push', (event) => { ... reg.showNotification(...) }); */
