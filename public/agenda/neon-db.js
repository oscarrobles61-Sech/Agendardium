/*
 * Cliente de base de datos para la agenda.
 * Expone la misma interfaz de documentos que usaba la versión HTML
 * (doc().get/set/delete/onSnapshot/acquire, collection().where/orderBy/limit/get/onSnapshot)
 * pero contra las rutas /api/db de Next.js, que guardan todo en Neon Postgres.
 * Los cambios de otros usuarios se detectan consultando /api/db/versions cada pocos segundos.
 */
(function () {
  const POLL_MS = 2500;

  async function call(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return r.json();
  }

  const splitPath = path => {
    const i = path.indexOf('/');
    return [path.slice(0, i), path.slice(i + 1)];
  };
  const snapDoc = (id, data) => ({ id, exists: data != null, data: () => data });
  const snapQuery = docs => ({ docs: docs.map(d => ({ id: d.id, exists: true, data: () => d.data })), size: docs.length, empty: !docs.length });

  /* ---------- suscripciones (sondeo por versión de colección) ---------- */
  const subs = new Set();
  let versions = {}, timer = null, busy = false, again = false;

  async function run(sub) {
    try {
      const res = await sub.fetch();
      const sig = JSON.stringify(res);
      if (sig === sub.sig || !subs.has(sub)) return;
      sub.sig = sig;
      sub.cb(sub.wrap(res));
    } catch (e) { if (sub.err) sub.err(e); }
  }

  async function tick(force) {
    if (busy) { again = again || !!force; return; }
    busy = true;
    try {
      let v = versions;
      try { v = await call('GET', '/api/db/versions'); } catch (e) {}
      const changed = new Set(Object.keys(v).filter(c => v[c] !== versions[c]));
      versions = v;
      await Promise.all([...subs].filter(s => force || changed.has(s.col)).map(run));
    } finally {
      busy = false;
      if (again) { again = false; tick(true); }
    }
  }

  function ensureTimer() {
    if (timer || !subs.size) return;
    timer = setInterval(() => { if (document.visibilityState !== 'hidden') tick(false); }, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(false); });
  window.addEventListener('focus', () => tick(false));

  function subscribe(col, fetchFn, wrap, cb, err) {
    const sub = { col, fetch: fetchFn, wrap, cb, err, sig: null };
    subs.add(sub);
    run(sub);
    ensureTimer();
    return () => {
      subs.delete(sub);
      if (!subs.size && timer) { clearInterval(timer); timer = null; }
    };
  }

  // Tras una escritura propia refrescamos enseguida, sin esperar al próximo sondeo.
  const afterWrite = () => { tick(true); };

  /* ---------- documentos ---------- */
  function doc(path) {
    const [col, id] = splitPath(path);
    const q = '/api/db/doc?col=' + encodeURIComponent(col) + '&id=' + encodeURIComponent(id);
    const fetchOne = async () => (await call('GET', q)).data;
    return {
      id,
      async get() { return snapDoc(id, await fetchOne()); },
      async set(data) { await call('PUT', '/api/db/doc', { col, id, data }); afterWrite(); },
      async delete() { await call('DELETE', q); afterWrite(); },
      async acquire(opts) { return call('POST', '/api/db/lock', { col, id, holder: opts.holder, ttlMs: opts.ttlMs }); },
      onSnapshot(cb, err) { return subscribe(col, fetchOne, data => snapDoc(id, data), cb, err); }
    };
  }

  /* ---------- consultas ---------- */
  function query(col, spec) {
    const fetchMany = async () => (await call('POST', '/api/db/query', Object.assign({ col }, spec))).docs;
    return {
      where(field, op, value) { return query(col, Object.assign({}, spec, { where: (spec.where || []).concat([[field, op, value]]) })); },
      orderBy(field, dir) { return query(col, Object.assign({}, spec, { orderBy: [field, dir || 'asc'] })); },
      limit(n) { return query(col, Object.assign({}, spec, { limit: n })); },
      async get() { return snapQuery(await fetchMany()); },
      onSnapshot(cb, err) { return subscribe(col, fetchMany, snapQuery, cb, err); }
    };
  }

  window.NeonDB = {
    // Devuelve null si el servidor no tiene base de datos configurada: la agenda pasa a modo local.
    async connect() {
      const h = await call('GET', '/api/health');
      if (!h || !h.db) return null;
      return { doc, collection: col => query(col, {}) };
    }
  };
})();
