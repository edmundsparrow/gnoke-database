/* ═══════════════════════════════════════════════════════════════
   gnoke-sync.js  v1.5
   Offline-first, scope-scoped event courier.
   ─────────────────────────────────────────────────────────────
   PRINCIPLE  :  No shared state. Only shared events.
   DEVICE     :  Execution unit  (offline-first)
   SERVER     :  Event collector + scope filter
   SYNC       :  Delayed courier delivery

   MENTAL MODEL
     Device = Truck  │  Event = Parcel
     Server = Depot  │  Sync  = Delivery

   DOMAIN AGNOSTIC
     This library is a courier. It moves parcels — it does not
     know or care what they contain. Define your own event types
     in your app. The base types (CREATE / UPDATE / DELETE) are
     the only ones the library uses internally.

   PUBLIC API
     GNOKE_SYNC.init(cfg)            → configure (call after identity resolves)
     GNOKE_SYNC.logEvent(type,e,p)   → queue event locally — no network
     GNOKE_SYNC.push()               → chunk + dispatch queued events
     GNOKE_SYNC.pull()               → scope-scoped fetch + master overwrite
     GNOKE_SYNC.authorize(token)     → activate sync token
     GNOKE_SYNC.start(ms?)           → begin push loop (default 30 s)
     GNOKE_SYNC.isReady()            → true if endpoint + auth both set
     GNOKE_SYNC.getQueueSnapshot()   → read-only copy of current queue
     GNOKE_SYNC.T                    → base event-type constants

   RULES
     • workspaceId MUST be resolved before init() is called
     • push() is a no-op if not authorised or no endpoint
     • pull() hard-overwrites master lists via onMasterUpdate
     • Max 10 events per request — protects low-end devices on 2G
     • App runs fine with no backend — every public fn is safe to call

   v1.2 changes (bridge-readiness, non-breaking):
     • init() now accepts an optional onLogEvent hook
     • logEvent() emits onLogEvent after the queue write
     • getQueueSnapshot() exposes a read-only copy of the queue
     • All new surface is optional; existing behaviour unchanged

   v1.3 changes (queue hygiene, non-breaking):
     • push() now guarded by _isPushing flag — concurrent calls are no-ops
     • push() drops synced parcels immediately after each successful chunk
     • logEvent() prunes queue before writing (synced + stale + ceiling)
     • init() accepts optional maxQueueAge (ms) and maxQueueLength (count)
     • start() now guarded by _started flag — safe to call multiple times
     • All new surface is optional; defaults are safe and conservative

   v1.5 changes (bug fixes, non-breaking):
     • push() URL fixed from path-routing (/dispatch) to query-string (?action=dispatch)
     • pull() URL fixed from path-routing (/updates) to query-string (?action=updates)
     • init() warning removed — was firing on every page load by design in gnoke-config.js
     • push() now warns and returns { reason: 'no_workspace_id' } if workspaceId not yet set


     • T constant trimmed to three base types only: CREATE, UPDATE, DELETE
       Domain event types belong in the consuming app, not this library
     • __syncHook removed — it hardcoded a domain entity name
     • All comments updated to reflect generic, any-app vision

   Designed to be reused across any webapp.
   Zero dependencies. No build step required.
═══════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /* ── CONSTANTS ────────────────────────────────────────────── */

  const QUEUE_KEY = 'gnoke_sync_queue';
  const AUTH_KEY  = 'gnoke_sync_auth';
  const MAX_CHUNK = 10; // 2G-safe batch ceiling per spec

  /*
    Base event types — these three are the only ones the library
    itself uses internally.

    For your own domain events (CONFIRM_ORDER, CANCEL_ITEM,
    REASSIGN_AGENT etc.) define them in your app, not here.
    Pass them freely to logEvent() — the courier does not inspect
    or restrict the type field beyond what you define.

    Example in your app:
      const MY_EVENTS = Object.freeze({
        CONFIRM_ORDER : 'CONFIRM_ORDER',
        CANCEL_ITEM   : 'CANCEL_ITEM',
      });
      GNOKE_SYNC.logEvent(MY_EVENTS.CONFIRM_ORDER, 'orders', payload);
  */
  const T = Object.freeze({
    CREATE : 'CREATE',
    UPDATE : 'UPDATE',
    DELETE : 'DELETE',
  });

  /* ── CONFIG ───────────────────────────────────────────────── */

  let _cfg = {
    endpoint       : '',       // set via init() — library works without it
    phone          : null,     // user phone        (human anchor)
    dk             : null,     // device key        (install identity)
    workspaceId       : null,     // scope id — MUST be set before any sync op
    onStatusChange : null,     // fn(recordId, status) → caller updates UI/storage
    onMasterUpdate : null,     // fn(entity, items)    → caller hard-overwrites local list
    // v1.3 — queue hygiene (optional; safe defaults applied if omitted)
    maxQueueAge    : 7 * 24 * 60 * 60 * 1000,  // 7 days — stale pending parcels dropped
    maxQueueLength : 500,                        // hard ceiling — keeps newest on overflow
  };

  // v1.2 — observability hook (optional, set via init())
  let _onLogEvent = null;      // fn(type, entity, payload, parcel)

  /* ── QUEUE ────────────────────────────────────────────────── */

  const _loadQ = () => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
    catch { return []; }
  };
  const _saveQ = q => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));

  /* ── QUEUE PRUNER (v1.3) ──────────────────────────────────── */
  /*
    Called before every logEvent() write.
    Three-pass hygiene — order matters:
      1. Drop synced parcels — delivered, no longer needed.
      2. Drop stale parcels  — older than maxQueueAge, presumed orphaned.
      3. Hard ceiling        — if still over maxQueueLength, keep newest.
    Only pending/failed parcels survive into the next write cycle.
  */
  function _pruneQ(q) {
    const cutoff = Date.now() - _cfg.maxQueueAge;
    const live = q.filter(p =>
      p.status !== 'synced' &&
      new Date(p.ts).getTime() > cutoff
    );
    return live.length > _cfg.maxQueueLength
      ? live.slice(-_cfg.maxQueueLength)
      : live;
  }

  /* ── AUTH ─────────────────────────────────────────────────── */

  const _getAuth      = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } };
  const _isAuthorized = () => { const a = _getAuth(); return a?.syncAuthorized === true && !!a?.syncToken; };

  /* ── PARCEL FACTORY ───────────────────────────────────────── */
  /*
    Every queued event is a self-describing parcel.
    The server needs no shared schema — the parcel carries its own context.
  */
  function _makeParcel(type, entity, payload) {
    return {
      id       : Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      type,                     // one of T.* or any app-defined event type
      entity,                   // collection name — e.g. 'orders' | 'patients' | 'messages'
      phone    : _cfg.phone,
      dk       : _cfg.dk,
      workspaceId : _cfg.workspaceId,
      payload,
      ts       : new Date().toISOString(),
      status   : 'pending',
    };
  }

  /* ── PUBLIC: logEvent ─────────────────────────────────────── */
  /*
    Store locally ONLY. No network. Safe to call while offline.
    This is the ONLY write path into the event queue.

    v1.2: emits onLogEvent after queue write (best-effort, non-blocking).
    The hook receives (type, entity, payload, parcel) so an external
    mediator can observe without touching the queue.

    v1.3: prunes queue before writing — synced, stale, and overflow
    parcels are dropped first, keeping localStorage lean.
  */
  function logEvent(type, entity, payload) {
    const parcel = _makeParcel(type, entity, payload);
    const q = _pruneQ(_loadQ()); // v1.3 — prune before write
    q.push(parcel);
    _saveQ(q);

    // v1.2 — notify bridge / external observer after queue write
    _onLogEvent?.(type, entity, payload, parcel);

    return parcel;
  }

  /* ── PUBLIC: push ─────────────────────────────────────────── */
  /*
    Flush pending queue in chunks of MAX_CHUNK.
    Requires: endpoint configured + authorisation active.
    On network failure: leaves parcels as 'pending' for next loop.
    On server rejection: marks chunk as 'failed', notifies caller.

    v1.3: guarded by _isPushing — concurrent calls (e.g. from overlapping
    setInterval ticks on slow connections) are no-ops until the current
    run completes. Flag is always released in a finally block.
    v1.3: synced parcels are dropped from the queue immediately after
    each successful chunk — no accumulation of delivered events.
  */
  let _isPushing = false; // v1.3 — concurrency guard

  async function push() {
    if (!_cfg.endpoint)   return { ok: false, reason: 'no_endpoint' };
    if (!_isAuthorized()) return { ok: false, reason: 'not_authorized' };
    if (_isPushing)       return { ok: false, reason: 'already_pushing' };

    if (!_cfg.workspaceId) {
      console.warn('[gnoke-sync] push() called before workspaceId is set — call GNOKE_SYNC.init({ workspaceId }) after identity resolves.');
      return { ok: false, reason: 'no_workspace_id' };
    }

    _isPushing = true; // v1.3 — lock

    try {
      const pending = _loadQ().filter(p => p.status === 'pending' || p.status === 'failed');
      if (!pending.length) return { ok: true, pushed: 0 };

      const { syncToken } = _getAuth();
      let pushed = 0;

      for (let i = 0; i < pending.length; i += MAX_CHUNK) {
        const chunk = pending.slice(i, i + MAX_CHUNK);
        const ids   = new Set(chunk.map(p => p.id));

        try {
          const res = await fetch(`${_cfg.endpoint}?action=dispatch`, {
            method  : 'POST',
            headers : {
              'Content-Type' : 'application/json',
              'X-Sync-Token' : syncToken,
            },
            body: JSON.stringify({ workspaceId: _cfg.workspaceId, events: chunk }),
          });

          /* Re-read queue — state may have shifted while awaiting */
          const live       = _loadQ();
          const nextStatus = res.ok ? 'synced' : 'failed';
          live.forEach(p => { if (ids.has(p.id)) p.status = nextStatus; });

          // v1.3 — drop synced parcels immediately; no point keeping delivered events
          const trimmed = res.ok
            ? live.filter(p => !ids.has(p.id))
            : live;
          _saveQ(trimmed);

          if (res.ok) {
            pushed += chunk.length;
            chunk.forEach(p => _cfg.onStatusChange?.(p.payload?.id, 'synced'));
          } else {
            chunk.forEach(p => _cfg.onStatusChange?.(p.payload?.id, 'failed'));
          }
        } catch {
          /* Network down — parcels stay 'pending', retry on next loop */
        }
      }

      return { ok: true, pushed };

    } finally {
      _isPushing = false; // v1.3 — always release, even on thrown error
    }
  }

  /* ── PUBLIC: pull ─────────────────────────────────────────── */
  /*
    Workspace-scoped fetch from server.

    MASTER LIST RULE:
    Any collections defined as masterList in MASTER_COLLECTIONS
    (gnoke-config.php) are returned here and HARD OVERWRITTEN on
    the device via onMasterUpdate(). localList = serverList — no
    merging, no appending. This is the correct fix for ghost
    duplicate records when a server-side admin edits a shared list.

    Which collections qualify is controlled entirely by gnoke-config.php.
    This library does not know or care what those collections contain.
  */
  async function pull() {
    if (!_cfg.endpoint)   return { ok: false, reason: 'no_endpoint' };
    if (!_isAuthorized()) return { ok: false, reason: 'not_authorized' };

    const { syncToken } = _getAuth();

    try {
      const res = await fetch(
        `${_cfg.endpoint}?action=updates&workspaceId=${encodeURIComponent(_cfg.workspaceId)}`,
        { headers: { 'X-Sync-Token': syncToken } }
      );
      if (!res.ok) return { ok: false, reason: 'server_error' };

      const data = await res.json();

      /* Hard-overwrite each master list present in the response.
         Which entities qualify as master lists is determined by
         the server (MASTER_COLLECTIONS in gnoke-config.php).
         The response keys match those collection names exactly. */
      const keys = Object.keys(data).filter(k => k !== 'ok');
      keys.forEach(entity => {
        if (Array.isArray(data[entity])) {
          _cfg.onMasterUpdate?.(entity, data[entity]);
        }
      });

      return { ok: true, data };
    } catch {
      return { ok: false, reason: 'network_error' };
    }
  }

  /* ── PUBLIC: authorize ────────────────────────────────────── */
  /*
    Called after the sync token is validated (e.g. after QR scan or
    after save-profile returns a token). Token must be present in
    every subsequent push/pull request.
    This is the ONLY activation path — sync is disabled by default.
  */
  function authorize(token) {
    if (!token || String(token).length < 8) return false;
    localStorage.setItem(AUTH_KEY, JSON.stringify({
      syncAuthorized : true,
      syncToken      : String(token),
      authorizedAt   : new Date().toISOString(),
    }));
    return true;
  }

  /* ── PUBLIC: init ─────────────────────────────────────────── */
  /*
    Configure and arm the library.
    Call AFTER identity is resolved (profile + device key available).
    workspaceId (scope id) is required — all sync is scoped to it.

    v1.2: accepts optional onLogEvent hook.
    The hook is called by logEvent() after every queue write.
    It MUST NOT mutate the parcel or the queue — observe only.

    v1.3: accepts optional maxQueueAge (ms) and maxQueueLength (count).
    Safe defaults are applied when omitted — no caller change required.
  */
  function init(config) {
    // v1.2 — capture observability hook before spreading config
    if (typeof config?.onLogEvent === 'function') {
      _onLogEvent = config.onLogEvent;
    }

    Object.assign(_cfg, config);

    return {
      authorized : _isAuthorized(),
      workspaceId   : _cfg.workspaceId,
      pending    : _loadQ().filter(p => p.status === 'pending').length,
    };
  }

  /* ── PUBLIC: start ────────────────────────────────────────── */
  /*
    Begin the push loop. Fires immediately, then every intervalMs.
    Safe to call multiple times — only the first call takes effect.
    Without this guard, a re-login or double-init would spin up a
    second setInterval and push every parcel twice per cycle.
  */
  let _started = false;
  function start(intervalMs = 30_000) {
    if (_started) return;
    _started = true;
    push();
    setInterval(push, intervalMs);
  }

  /* ── PUBLIC: getQueueSnapshot (v1.2) ─────────────────────── */
  /*
    Returns a shallow copy of the current queue for external inspection.
    Read-only by convention — callers MUST NOT mutate the returned array.
    Use this instead of reaching into localStorage directly.
  */
  function getQueueSnapshot() {
    return _loadQ();
  }

  /* ── PUBLIC: isReady / isAuthorized ──────────────────────── */
  const isReady      = () => !!_cfg.endpoint && _isAuthorized();
  const isAuthorized = () => _isAuthorized();

  /* ── EXPORT ───────────────────────────────────────────────── */

  root.GNOKE_SYNC = Object.freeze({
    T,
    init,
    logEvent,
    push,
    pull,
    authorize,
    start,
    isReady,
    isAuthorized,
    getQueueSnapshot,
  });

})(window);


