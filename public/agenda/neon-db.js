/*
 * Cliente de base de datos para la agenda.
 * Expone la misma interfaz de documentos que usaba la versión HTML
 * (doc().get/set/delete/onSnapshot/acquire, collection().where/orderBy/limit/get/onSnapshot)
 * pero contra las rutas /api/db de Next.js, que guardan todo en Neon Postgres.
 * Los cambios de otros usuarios se detectan consultando /api/db/versions cada pocos segundos.
 * El sondeo se espacia cuando nadie usa la pantalla (ahorra pedidos a Vercel y deja dormir a Neon)
 * y se corta con la pestaña oculta. Al volver a usarla se consulta enseguida.
 */
(function () {
  // Cada cuánto se consulta según hace cuánto que no se toca la pantalla.
  const POLL_ACTIVE_MS = 6000;               // en uso
  const POLL_IDLE_MS = 20000;                // más de 2 minutos sin tocar nada
  const POLL_AWAY_MS = 60000;                // más de 10 minutos sin tocar nada
  const IDLE_AFTER = 2 * 60000, AWAY_AFTER = 10 * 60000;
  let lastInput = Date.now();
  const pollEvery = () => {
    const quiet = Date.now() - lastInput;
    return quiet > AWAY_AFTER ? POLL_AWAY_MS : quiet > IDLE_AFTER ? POLL_IDLE_MS : POLL_ACTIVE_MS;
  };

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
      // Sesión vencida o cerrada: la agenda vuelve a la pantalla de ingreso.
      if (r.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('agenda:sin-sesion'));
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

  /* ---------- usuarios en línea ---------- */
  // pres.state(): qué está haciendo esta persona (lo arma app.js); pres.cb(lista): llega en cada sondeo.
  const pres = { state: null, cb: null, device: (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 'tel' : 'pc', sent: '' };
  function leave() {
    if (!pres.state) return;
    try {
      const blob = new Blob([JSON.stringify({ leave: true })], { type: 'application/json' });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/db/versions', blob))) fetch('/api/db/versions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"leave":true}', keepalive: true }).catch(() => {});
    } catch (e) {}
  }
  // Al cerrar la pestaña deja de figurar enseguida (si no llega, desaparece solo en 90 s).
  window.addEventListener('pagehide', leave);
  // Si cambió lo que hace (abrió un turno, cambió de agenda o de sección) se avisa sin esperar al próximo sondeo.
  setInterval(() => {
    if (!pres.state || !subs.size || document.visibilityState === 'hidden') return;
    let cur = ''; try { cur = JSON.stringify(pres.state()); } catch (e) { return; }
    if (cur !== pres.sent) { pres.sent = cur; tick(false); }
  }, 1500);

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
      try {
        if (pres.state) {
          // Mismo pedido: versiones + señal de "estoy acá" + lista de quién más está en línea.
          const r = await call('POST', '/api/db/versions', { p: pres.state(), idleMs: Date.now() - lastInput, device: pres.device });
          v = r.versions || v;
          if (r.online && pres.cb) { try { pres.cb(r.online); } catch (e) { console.error(e); } }
        } else v = await call('GET', '/api/db/versions');
      } catch (e) {}
      const changed = new Set(Object.keys(v).filter(c => v[c] !== versions[c]));
      versions = v;
      await Promise.all([...subs].filter(s => force || changed.has(s.col)).map(run));
    } finally {
      busy = false;
      if (again) { again = false; tick(true); }
    }
  }

  let lastTick = 0;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!subs.size) return;
    timer = setTimeout(() => {
      timer = null;
      if (document.visibilityState !== 'hidden') { lastTick = Date.now(); tick(false); }
      schedule();
    }, pollEvery());
  }
  const ensureTimer = () => { if (!timer) schedule(); };
  // Volver a usar la pantalla después de un rato quieta: se consulta ya y se vuelve al ritmo normal.
  const onInput = () => {
    const wasQuiet = Date.now() - lastInput > IDLE_AFTER;
    lastInput = Date.now();
    if (wasQuiet && subs.size && Date.now() - lastTick > POLL_ACTIVE_MS) { lastTick = Date.now(); tick(false); schedule(); }
  };
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => window.addEventListener(ev, onInput, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { lastInput = Date.now(); tick(false); schedule(); } });
  window.addEventListener('focus', () => { lastInput = Date.now(); tick(false); });

  function subscribe(col, fetchFn, wrap, cb, err) {
    const sub = { col, fetch: fetchFn, wrap, cb, err, sig: null };
    subs.add(sub);
    run(sub);
    ensureTimer();
    return () => {
      subs.delete(sub);
      if (!subs.size && timer) { clearTimeout(timer); timer = null; }
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
      // snap.rev: revisión leída. Pasándola a set({ ifRev }) el servidor rechaza (409) si otra persona guardó en el medio.
      async get() { const r = await call('GET', q); const s = snapDoc(id, r.data); s.rev = r.rev || 0; return s; },
      async set(data, opts) {
        const body = { col, id, data };
        if (opts && Number.isInteger(opts.ifRev)) body.ifRev = opts.ifRev;
        try { const r = await call('PUT', '/api/db/doc', body); afterWrite(); return r; }
        catch (e) { if (e.status === 409) afterWrite(); throw e; }
      },
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
    },
    // Ingreso con DNI + PIN: el servidor guarda la sesión en una cookie y controla los permisos.
    auth: {
      state: () => call('GET', '/api/auth/state'),
      login: (dni, pin) => call('POST', '/api/auth/login', { dni, pin }),
      logout: () => call('POST', '/api/auth/logout', {}),
      setup: (name, dni, pin, cfg) => call('POST', '/api/auth/setup', { name, dni, pin, cfg }),
      claim: (id, dni, pin) => call('POST', '/api/auth/claim', { id, dni, pin }),
      // Crear el PIN con el pase del ingreso, o cambiarlo con sesión iniciada ({ current, pin }).
      setPin: body => call('POST', '/api/auth/pin', body),
      // Solo administración: estado de los PIN, PIN temporal, desbloquear y exigir PIN.
      pins: () => call('GET', '/api/auth/pins'),
      pinAction: body => call('POST', '/api/auth/pins', body)
    },
    // Avisos entre secretaría y profesionales (rutas /api/avisos y /api/push).
    api: (method, url, body) => call(method, url, body),
    // Usuarios en línea: state() devuelve qué está haciendo esta persona; cb recibe la lista en cada sondeo.
    presence(state, cb) { pres.state = state; pres.cb = cb; pres.sent = ''; if (subs.size) tick(false); },
    // Corta todas las suscripciones (al cerrar sesión) y deja de figurar en línea.
    stopAll() { leave(); pres.state = null; pres.cb = null; subs.clear(); if (timer) { clearTimeout(timer); timer = null; } versions = {}; }
  };
})();
