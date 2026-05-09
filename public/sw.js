// Service Worker — 알림 수신 및 클릭 처리.
//
// `/sw.js` 경로로 서빙되며 클라이언트가 navigator.serviceWorker.register('/sw.js') 호출.
// 페이지가 닫혀있어도 OS 레벨에서 알림 표시 (브라우저 백그라운드 데몬이 처리).

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "gons.dashboard", body: event.data.text() };
  }

  const { title, body, url, tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title || "gons.dashboard", {
      body: body || "",
      tag: tag || "default",
      data: { url: url || "/" },
      badge: "/icon-192.png",
      icon: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // 이미 열려있는 탭이 있으면 거기로 focus.
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }
        // 없으면 새 탭.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
