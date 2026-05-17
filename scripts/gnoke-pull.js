/* ════════════════════════════════════════════════════════════
   gnoke-pull.js  v1.2
   Server → device reconciliation. Generic pull leg.
   Companion to gnoke-sync.js (handles push leg only).
   ────────────────────────────────────────────────────────────
   PRINCIPLE  :  Server wins for mutable fields. Device owns identity.
   DIRECTION  :  Server → Device  (return leg of sync)
   SCOPE      :  Identity-chain scoped — pull returns only what
                 this operator is authorised to see.

   WHAT THIS SOLVES
   ────────────────────────────────────────────────────────────
   GNOKE_SYNC.pull() fetches master lists only.
   This module adds the full record return leg — manager edits,
   status corrections, and any server-side mutations flow back
   to the operator's device for every defined collection.

   DEPENDENCY
   ────────────────────────────────────────────────────────────
   Requires GnokeStore (gnoke-store.js) to be loaded first.
   Identity, collection definitions, merge rules, and onChange
   notifications are all owned by GnokeStore — this module
   only handles the network fetch and hands results to the store.

   No internal merge logic. No direct localStorage access.
   GnokeStore.merge() fires onChange listeners automatically
   after every successful pull — the UI re-renders without
   any extra wiring in the app.

   PUBLIC API
   ────────────────────────────────────────────────────────────
     GNOKE_PULL.init(cfg)   → configure timing + hooks
     GNOKE_PULL.pull()      → run one full pull immediately
     GNOKE_PULL.start(ms?)  → schedule loop (default 5 min, 3 s boot delay)

   CONFIG  (all optional — safe defaults apply)
   ────────────────────────────────────────────────────────────
     bootDelay   : ms before first pull after start()   (default 3000)
     interval    : ms between scheduled pulls            (default 300000)
     onUpdate    : fn({ collection, merged, added, skipped })
                   called after each collection pull completes
     onError     : fn(reason, collection?)
                   called on network or auth failure

   USAGE
   ────────────────────────────────────────────────────────────
     // After GnokeStore.configure() + GnokeStore.define() + authorize:
     GNOKE_PULL.init({
       onUpdate: ({ collection, merged, added }) => {
         if (merged || added) console.log(`${collection}: ${added} added, ${merged} updated`);
       },
     });
     GNOKE_PULL.start();

   LOAD ORDER
   ────────────────────────────────────────────────────────────
     gnoke-store.js   ← must load first (identity + merge)
     gnoke-sync.js    ← must load second (isReady check)
     gnoke-pull.js    ← here
     gnoke-config.js  ← configures all three
     [app scripts]

   v1.2 changes (since cursor fix, non-breaking):
     • since cursor now stores max(updated_at) from server response, not client clock
       — devices with wrong clocks no longer miss or double-fetch records


   Zero dependencies beyond GnokeStore + GnokeSync.
   No build step required.
════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /* ── CONFIG ───────────────────────────────────────────────── */

  let _cfg = {
    bootDelay   : 3000,              // ms before first pull after start()
    interval    : 5 * 60 * 1000,    // ms between scheduled pulls (5 min)
    onUpdate    : null,              // fn({ collection, merged, added, skipped })
    onError     : null,              // fn(reason, collection?)
    pullFilters : {},                // { collection: { field: val, field_gt: val, … } }
  };

  /* ── AUTH HELPER ──────────────────────────────────────────── */
  /*
    Reads the sync token written by GNOKE_SYNC.authorize().
    Same key gnoke-sync.js uses — no duplication of storage logic.
  */
  function _syncToken() {
    try { return JSON.parse(localStorage.getItem('gnoke_sync_auth'))?.syncToken || null; }
    catch { return null; }
  }

  /* ── PULL ONE COLLECTION ──────────────────────────────────── */
  /*
    Fetches records for a single collection from the server.
    Identity params come entirely from GnokeStore.getIdentity() —
    this module never reads localStorage for profile data directly.

    Pull timestamp is scoped per collection so a failed pull on
    one collection does not reset the cursor for others.
  */
  async function _pullCollection(collection, identity, token) {
    const { endpoint, company_id, app_id, workspace_id, user_id } = identity;
    const schema  = root.GnokeStore.getSchema(collection);

    /* Build the since cursor key scoped to this collection + user */
    const tsKey   = `gnoke_pull_ts_${company_id}_${app_id}_${user_id}_${collection}`;
    const since   = localStorage.getItem(tsKey) || '';

    /* Build query params — always send full identity chain */
    const params  = new URLSearchParams({ collection, company_id, app_id });
    if (schema?.scope !== 'company') params.set('workspace_id', workspace_id);

    /* Scope by user_id for user-scoped collections */
    if (schema?.scope === 'user' && user_id) params.set('user_id', user_id);

    /* Incremental pull — only records changed since last successful pull */
    if (since) params.set('since', since);

    /* Per-collection server-side filters — forwarded as filter[key]=val */
    const filters = _cfg.pullFilters?.[collection] || {};
    Object.entries(filters).forEach(([k, v]) => params.set(`filter[${k}]`, v));

    const res = await fetch(
      `${endpoint}?action=get&${params.toString()}`,
      { headers: { 'X-Sync-Token': token } }
    );

    if (!res.ok) {
      _cfg.onError?.(`http_${res.status}`, collection);
      return { ok: false, reason: `http_${res.status}`, collection };
    }

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.records)) {
      _cfg.onError?.('bad_response', collection);
      return { ok: false, reason: 'bad_response', collection };
    }

    /*
      Hand records to GnokeStore.merge().
      The store applies serverWins + immutable rules from the schema
      and fires onChange listeners automatically — no extra wiring needed.

      Server records come back in the { id, data, ... } envelope from
      gnoke-api.php. We flatten data into the record so GnokeStore
      receives the same shape the app uses locally.
    */
    const flattened = data.records.map(row => ({
      ...( row.data || {} ),
      id         : row.id,
      created_at : row.created_at,
      updated_at : row.updated_at,
      _deleted   : row.deleted === 1 || row.deleted === true,
    }));

    const result = root.GnokeStore.merge(collection, flattened);

    /* Advance the cursor to the latest server timestamp in this batch.
       Using the server's own updated_at value (not client clock) means
       a device with a wrong clock will never miss or double-fetch records. */
    if (flattened.length > 0) {
      const latestTs = flattened.reduce((max, r) => {
        return r.updated_at > max ? r.updated_at : max;
      }, '');
      if (latestTs) localStorage.setItem(tsKey, latestTs);
    }

    const outcome = { ok: true, collection, ...result };
    _cfg.onUpdate?.(outcome);

    if (result.merged > 0 || result.added > 0) {
      console.info(`[gnoke-pull] ${collection}: ${result.added} added · ${result.merged} updated`);
    }

    return outcome;
  }

  /* ── PUBLIC: pull ─────────────────────────────────────────── */
  /*
    Runs a full pull cycle across every collection defined in GnokeStore.

    Guards:
      1. GnokeStore must be ready (identity fully resolved).
      2. GNOKE_SYNC must be authorised (token present + endpoint set).

    Collections are pulled sequentially — not in parallel — to avoid
    hammering the server from low-end devices on 2G connections.
  */
  async function pull() {
    /* Guard 1 — identity */
    if (!root.GnokeStore?.isReady()) {
      return { ok: false, reason: 'store_not_ready' };
    }

    /* Guard 2 — auth */
    if (!root.GNOKE_SYNC?.isReady()) {
      return { ok: false, reason: 'not_authorized' };
    }

    const identity    = root.GnokeStore.getIdentity();
    const token       = _syncToken();
    const collections = root.GnokeStore.getDefinedCollections();

    if (!collections.length) return { ok: true, reason: 'no_collections' };
    if (!token)              return { ok: false, reason: 'no_token' };

    const results = [];

    for (const collection of collections) {
      try {
        const r = await _pullCollection(collection, identity, token);
        results.push(r);
      } catch (err) {
        /* Non-fatal — one failed collection does not abort the rest */
        console.warn(`[gnoke-pull] ${collection} failed:`, err.message);
        _cfg.onError?.(err.message, collection);
        results.push({ ok: false, collection, reason: 'network_error' });
      }
    }

    return { ok: true, results };
  }

  /* ── PUBLIC: init ─────────────────────────────────────────── */
  /*
    Configure timing and hooks.
    Call after GnokeStore.configure() and GnokeStore.define() are done.
    All fields are optional — defaults are production-safe.
  */
  function init(cfg) {
    if (cfg) Object.assign(_cfg, cfg);
  }

  /* ── PUBLIC: start ────────────────────────────────────────── */
  /*
    Schedule the pull loop.
    Fires once after bootDelay, then every interval.
    Safe to call multiple times — only the first call takes effect.
  */
  let _running = false;
  function start(intervalMs) {
    if (_running) return;
    _running = true;
    const iv = intervalMs ?? _cfg.interval;
    setTimeout(pull, _cfg.bootDelay);
    setInterval(pull, iv);
  }

  /* ── EXPORT ───────────────────────────────────────────────── */

  root.GNOKE_PULL = Object.freeze({ init, pull, start });

})(window);


