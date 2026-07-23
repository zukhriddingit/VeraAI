"use strict";

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  const safePath =
    payload &&
    typeof payload.deepLink === "string" &&
    /^\/listings\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(payload.deepLink)
      ? payload.deepLink
      : "/";
  event.waitUntil(
    self.registration.showNotification("Vera found a new match", {
      body: "Open Vera to review a new listing.",
      data: { path: safePath },
      tag: `vera-match:${safePath}`
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path =
    event.notification.data && typeof event.notification.data.path === "string"
      ? event.notification.data.path
      : "/";
  event.waitUntil(self.clients.openWindow(new URL(path, self.location.origin).href));
});
