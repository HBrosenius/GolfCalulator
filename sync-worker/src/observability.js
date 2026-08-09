function clean(value, limit = 500) {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, limit) : undefined;
}

export function structuredLog(level, event, fields = {}) {
  const entry = { level, event, timestamp: new Date().toISOString(), ...fields };
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
  return entry;
}

function sentryEnvelope(dsn, entry) {
  const url = new URL(dsn);
  const projectId = url.pathname.split('/').filter(Boolean).pop();
  if (!projectId || !url.username) throw new Error('Invalid Sentry DSN');
  const endpoint = `${url.protocol}//${url.host}/api/${projectId}/envelope/`;
  const eventId = crypto.randomUUID().replaceAll('-', '');
  const header = JSON.stringify({ event_id: eventId, dsn, sent_at: new Date().toISOString() });
  const item = JSON.stringify({ type: 'event' });
  const payload = JSON.stringify({
    event_id: eventId,
    timestamp: Date.now() / 1000,
    level: entry.level || 'error',
    platform: 'javascript',
    environment: entry.environment || 'production',
    release: entry.release,
    message: clean(entry.event, 200) || 'worker_error',
    tags: { component: entry.component || 'worker', event: entry.event || 'unknown' },
    extra: Object.fromEntries(Object.entries(entry).filter(([key]) => !['level', 'event'].includes(key))),
  });
  return { endpoint, body: `${header}\n${item}\n${payload}` };
}

async function forward(env, entry, alert) {
  const tasks = [];
  if (env.SENTRY_DSN) {
    try {
      const envelope = sentryEnvelope(env.SENTRY_DSN, entry);
      tasks.push(fetch(envelope.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope' }, body: envelope.body }));
    } catch (error) {
      structuredLog('warn', 'sentry_configuration_invalid', { error: clean(error?.message) });
    }
  }
  if (alert && env.ALERT_WEBHOOK_URL) {
    tasks.push(fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Poängbogey: ${entry.event}`, ...entry }),
    }));
  }
  await Promise.allSettled(tasks);
}

export function reportOperationalError(env, event, fields = {}, ctx = null, options = {}) {
  const entry = structuredLog(options.level || 'error', event, {
    component: fields.component || 'worker', environment: env.ENVIRONMENT || 'production',
    release: env.RELEASE_VERSION || undefined,
    ...fields,
    error: clean(fields.error), path: clean(fields.path, 200),
  });
  const delivery = forward(env, entry, !!options.alert);
  if (ctx) ctx.waitUntil(delivery);
  else return delivery;
}

export function clientErrorPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const kind = ['error', 'unhandledrejection'].includes(body.kind) ? body.kind : null;
  const message = clean(body.message, 300);
  if (!kind || !message) return null;
  return { kind, message, source: clean(body.source, 200), line: Number.isInteger(body.line) ? body.line : undefined };
}
