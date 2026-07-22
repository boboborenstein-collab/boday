// Web Push handlers, imported into the generated service worker.
// Payload shape (JSON): { title, body, url?, taskId?, dateStr?, actionToken? }

const PUSH_WORKER = 'https://boday-push.boapps.workers.dev'

self.addEventListener('push', (event) => {
  let payload = { title: 'BoDay', body: 'You have a reminder.' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // non-JSON payload; use defaults
  }
  const actions =
    payload.taskId && payload.actionToken
      ? [
          { action: 'done', title: 'Done' },
          { action: 'snooze-30', title: 'Snooze 30m' },
        ]
      : []
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: {
        url: payload.url || '/',
        taskId: payload.taskId,
        dateStr: payload.dateStr,
        actionToken: payload.actionToken,
      },
      actions,
    }),
  )
})

async function postPushAction(action, data) {
  if (!data?.actionToken) return
  const actionName = action === 'done' ? 'done' : action === 'snooze-30' ? 'snooze30' : null
  if (!actionName) return
  await fetch(`${PUSH_WORKER}/push-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: data.actionToken, action: actionName }),
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const action = event.action

  if (action === 'done' || action === 'snooze-30') {
    event.waitUntil(
      postPushAction(action, data).then(() =>
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
          for (const client of clients) {
            if ('focus' in client) return client.focus()
          }
          return self.clients.openWindow(data.url || '/')
        }),
      ),
    )
    return
  }

  const url = data.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
