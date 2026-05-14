/* ═══════════════════════════════════════════════════════════════
   gnoke-store.js  v1.1
   The collection engine for GnokeDatabase.
   ─────────────────────────────────────────────────────────────
   WHAT THIS IS
     The missing layer between your app and localStorage.
     Every app manages storage keys manually today — this makes
     that invisible. Configure once, use everywhere.

   MENTAL MODEL
     GnokeStore  = Firebase Firestore (client-side, scoped)
     collection  = Firestore collection
     record      = Firestore document
     configure() = new Firebase(config)
     define()    = collection schema registration
     save()      = setDoc()
     query()     = getDocs() with filter
     update()    = updateDoc()
     remove()    = deleteDoc()
     onChange()  = onSnapshot()

   IDENTITY CHAIN (key namespace)
     Every record lives under a fully-qualified key:
     gnoke_{company_id}_{app_id}_{workspace_id}_{user_id}_{collection}
     App code never sees this key. It only sees collection names.

   PUBLIC API
     GnokeStore.configure(cfg)        → set identity + endpoint
     GnokeStore.define(name, schema)  → register a collection
     GnokeStore.save(col, payload)    → write a record, returns id
     GnokeStore.update(col, id, patch)→ patch fields on a record
     GnokeStore.remove(col, id)       → soft-delete a record
     GnokeStore.query(col, filterFn?) → read records (all or filtered)
     GnokeStore.getOne(col, id)       → read a single record by id
     GnokeStore.onChange(col, cb)     → subscribe to collection changes
     GnokeStore.merge(col, records)   → server → local merge (for pull)
     GnokeStore.configure()           → returns current identity snapshot
     GnokeStore.isReady()             → true if identity fully resolved

   SCHEMA OPTIONS (per collection via define())
     scope            : 'user' | 'workspace' | 'company'
                        'user'    → scoped to user_id  (personal records)
                        'workspace' → scoped to workspace_id (shared within a group)
                        'company' → scoped to company_id (global)
     serverWins       : ['field', ...]  fields the server can overwrite
     immutable        : ['field', ...]  fields that never change after creation
     masterList       : true            server fully replaces local on pull
     compactAfterDays : number          days before _deleted records are purged
                        default: 30. Set to 0 to disable per-collection.

   RULES
     • configure() MUST be called before any read or write
     • define() MUST be called before save/query/update/remove
     • company_id and app_id are set by the developer — never user-supplied
     • user_id and workspace_id are set after profile resolves
     • onChange callbacks fire after every local write AND server merge
     • masterList collections are HARD OVERWRITTEN on merge — no append
     • _deleted records are purged automatically after merge if they are
       older than compactAfterDays — keeping localStorage lean over time

   v1.1 changes (storage hygiene, non-breaking):
     • define() accepts optional compactAfterDays per collection (default 30)
     • compact(collection) added — purges _deleted records past the age threshold
     • merge() calls compact() automatically after every successful merge
     • compact() exposed publicly for manual triggers (e.g. on app boot)
     • _guardReady() is now scope-aware — throws on malformed keys before
       they silently persist to localStorage

   Zero dependencies. No build step required.
   Part of GnokeDatabase — your own Firebase.
═══════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /* ── Identity ─────────────────────────────────────────────── */

  let _identity = {
    endpoint   : '',
    company_id : '',
    app_id     : '',
    workspace_id  : '',
    user_id    : '',
  };

  /* ── Collection registry ──────────────────────────────────── */
  /*
    _collections = {
      [name]: {
        scope            : 'user' | 'workspace' | 'company',
        serverWins : ['field', ...],
        immutable  : ['field', ...],
        masterList : false,
      }
    }
  */
  const _collections = {};

  /* ── onChange subscribers ─────────────────────────────────── */
  /*
    _listeners = { [collection]: [ callback, ... ] }
    Each callback receives the full record array after any change.
  */
  const _listeners = {};

  /* ── ID generator ─────────────────────────────────────────── */

  function _genId() {
    return 'gk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ── Storage key builder ──────────────────────────────────── */
  /*
    The key encodes the full identity chain.
    Scope controls how deep the namespace goes:
      user    → full chain (most specific — personal records)
      workspace → up to workspace_id (shared within a group)
      company → up to app_id (shared across the whole company)
  */
  function _key(collection) {
    const schema = _collections[collection];
    if (!schema) throw new Error(`[gnoke-store] Collection "${collection}" not defined. Call GnokeStore.define() first.`);

    const { company_id, app_id, workspace_id, user_id } = _identity;

    switch (schema.scope) {
      case 'company': return `gnoke_${company_id}_${app_id}_${collection}`;
      case 'workspace':  return `gnoke_${company_id}_${app_id}_${workspace_id}_${collection}`;
      case 'user':
      default:        return `gnoke_${company_id}_${app_id}_${workspace_id}_${user_id}_${collection}`;
    }
  }

  /* ── Raw localStorage read/write ─────────────────────────── */

  function _load(collection) {
    try {
      return JSON.parse(localStorage.getItem(_key(collection))) || [];
    } catch {
      return [];
    }
  }

  function _persist(collection, records) {
    localStorage.setItem(_key(collection), JSON.stringify(records));
  }

  /* ── Notify listeners ─────────────────────────────────────── */

  function _notify(collection) {
    const cbs = _listeners[collection];
    if (!cbs || !cbs.length) return;
    // Pass a fresh copy — callers must not mutate it
    const snapshot = _load(collection).filter(r => !r._deleted);
    cbs.forEach(cb => {
      try { cb(snapshot); } catch (e) { console.warn('[gnoke-store] onChange error:', e); }
    });
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: configure(cfg)
     Set or read back the identity + endpoint.
     Call after profile + device key resolve.
     Can be called again to update workspace_id / user_id
     once the user's workspace resolves.
  ══════════════════════════════════════════════════════════ */
  function configure(cfg) {
    if (cfg) Object.assign(_identity, cfg);
    // Return a snapshot so caller can confirm what was set
    return { ..._identity };
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: define(name, schema)
     Register a collection before any read or write.

     define('invoices', {
       scope      : 'user',
       serverWins : ['status', 'paid_at'],
       immutable  : ['created_at'],
       masterList : false,
     });
  ══════════════════════════════════════════════════════════ */
  function define(name, schema = {}) {
    _collections[name] = {
      scope            : schema.scope            || 'user',
      serverWins       : schema.serverWins       || [],
      immutable        : schema.immutable        || ['id', 'created_at'],
      masterList       : schema.masterList       || false,
      compactAfterDays : schema.compactAfterDays !== undefined
                           ? schema.compactAfterDays
                           : 30,
    };
    return GnokeStore; // chainable
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: save(collection, payload)
     Write a new record. Returns the generated id immediately.
     No network call — persists locally, sync.js pushes async.
  ══════════════════════════════════════════════════════════ */
  function save(collection, payload) {
    _guardReady(collection);
    _guardDefined(collection);

    const id  = _genId();
    const now = new Date().toISOString();

    const record = {
      ...payload,
      id,
      created_at : now,
      updated_at : now,
      _deleted   : false,
    };

    const records = _load(collection);
    records.push(record);
    _persist(collection, records);
    _notify(collection);

    return id;
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: update(collection, id, patch)
     Patch fields on an existing record.
     Immutable fields in the schema are silently skipped.
     Returns true if found and updated, false if not found.
  ══════════════════════════════════════════════════════════ */
  function update(collection, id, patch) {
    _guardReady(collection);
    _guardDefined(collection);

    const schema  = _collections[collection];
    const records = _load(collection);
    const idx     = records.findIndex(r => r.id === id);
    if (idx === -1) return false;

    const now = new Date().toISOString();

    Object.keys(patch).forEach(field => {
      // Never overwrite immutable fields
      if (schema.immutable.includes(field)) return;
      records[idx][field] = patch[field];
    });

    records[idx].updated_at = now;
    _persist(collection, records);
    _notify(collection);
    return true;
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: remove(collection, id)
     Soft-delete — marks _deleted: true, never removes from store.
     This preserves the record for server sync (so the server
     knows to delete it too) and for audit purposes.
     Returns true if found, false if not found.
  ══════════════════════════════════════════════════════════ */
  function remove(collection, id) {
    _guardReady(collection);
    _guardDefined(collection);

    const records = _load(collection);
    const idx     = records.findIndex(r => r.id === id);
    if (idx === -1) return false;

    records[idx]._deleted    = true;
    records[idx].updated_at  = new Date().toISOString();
    _persist(collection, records);
    _notify(collection);
    return true;
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: query(collection, filterFn?)
     Read records from local store. Never hits the network.
     Deleted records are excluded unless filterFn explicitly
     checks _deleted. Always returns a fresh copy.

     const open = GnokeStore.query('invoices', r => r.status === 'pending');
     const all  = GnokeStore.query('invoices');
  ══════════════════════════════════════════════════════════ */
  function query(collection, filterFn) {
    _guardReady(collection);
    _guardDefined(collection);

    const records = _load(collection).filter(r => !r._deleted);
    return filterFn ? records.filter(filterFn) : records;
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: getOne(collection, id)
     Read a single record by id. Returns null if not found.
  ══════════════════════════════════════════════════════════ */
  function getOne(collection, id) {
    _guardReady(collection);
    _guardDefined(collection);

    return _load(collection).find(r => r.id === id && !r._deleted) || null;
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: onChange(collection, callback)
     Subscribe to all writes on a collection.
     Fires immediately with the current state so the caller
     can render without a separate initial query call.
     Returns an unsubscribe function.

     const unsub = GnokeStore.onChange('invoices', records => renderTable(records));
     // later: unsub();
  ══════════════════════════════════════════════════════════ */
  function onChange(collection, callback) {
    _guardDefined(collection);

    if (!_listeners[collection]) _listeners[collection] = [];
    _listeners[collection].push(callback);

    // Fire immediately with current state
    try {
      const snapshot = _load(collection).filter(r => !r._deleted);
      callback(snapshot);
    } catch (e) {
      console.warn('[gnoke-store] onChange immediate fire error:', e);
    }

    // Return unsubscribe
    return function () {
      const cbs = _listeners[collection];
      if (!cbs) return;
      const idx = cbs.indexOf(callback);
      if (idx !== -1) cbs.splice(idx, 1);
    };
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: merge(collection, serverRecords)
     Server → local reconciliation. Called by gnoke-pull.js.
     App code should never call this directly.

     MERGE RULES:
       masterList = true  → hard overwrite. localStore = serverRecords.
       serverWins fields  → server value overwrites local value.
       immutable fields   → local value is never overwritten.
       New server record  → appended to local store.
       _deleted on server → marks local record _deleted: true.
  ══════════════════════════════════════════════════════════ */
  function merge(collection, serverRecords) {
    _guardDefined(collection);
    if (!Array.isArray(serverRecords) || !serverRecords.length) return { merged: 0, added: 0, skipped: 0 };

    const schema = _collections[collection];

    /* ── Master list: hard overwrite ── */
    if (schema.masterList) {
      _persist(collection, serverRecords.map(r => ({ ...r, _deleted: false })));
      _notify(collection);
      return { merged: 0, added: serverRecords.length, skipped: 0 };
    }

    /* ── Normal collection: field-level merge ── */
    let local = _load(collection);
    const index = new Map(local.map((r, i) => [r.id, i]));
    let merged = 0, added = 0, skipped = 0;

    serverRecords.forEach(srv => {
      if (!srv.id) { skipped++; return; }

      if (index.has(srv.id)) {
        const i = index.get(srv.id);
        let changed = false;

        // Apply serverWins fields
        schema.serverWins.forEach(field => {
          if (srv[field] !== undefined && local[i][field] !== srv[field]) {
            // Skip immutable fields — device ownership is sacred
            if (schema.immutable.includes(field)) return;
            local[i][field] = srv[field];
            changed = true;
          }
        });

        // Propagate server-side deletion
        if (srv._deleted && !local[i]._deleted) {
          local[i]._deleted   = true;
          local[i].updated_at = srv.updated_at || new Date().toISOString();
          changed = true;
        }

        changed ? merged++ : skipped++;
      } else {
        // New record from server — append
        index.set(srv.id, local.length);
        local.push({ ...srv, _deleted: srv._deleted || false });
        added++;
      }
    });

    if (merged > 0 || added > 0) {
      _persist(collection, local);
      _notify(collection);
    }

    // Auto-compact after every merge — runs silently, never blocks UI
    compact(collection);

    return { merged, added, skipped };
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: isReady()
     Returns true when the minimum identity is set.
     gnoke-pull.js and app code can gate on this.
  ══════════════════════════════════════════════════════════ */
  function isReady() {
    return !!(
      _identity.endpoint   &&
      _identity.company_id &&
      _identity.app_id     &&
      _identity.workspace_id  &&
      _identity.user_id
    );
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: getDefinedCollections()
     Returns all registered collection names.
     Used by gnoke-pull.js to loop over collections for pull.
  ══════════════════════════════════════════════════════════ */
  function getDefinedCollections() {
    return Object.keys(_collections);
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: getSchema(collection)
     Returns the schema for a collection.
     Used by gnoke-pull.js to read serverWins, scope etc.
  ══════════════════════════════════════════════════════════ */
  function getSchema(collection) {
    return _collections[collection] || null;
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: getIdentity()
     Returns current identity snapshot.
     Used by gnoke-pull.js to build fetch params.
  ══════════════════════════════════════════════════════════ */
  function getIdentity() {
    return { ..._identity };
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: compact(collection)
     Purge _deleted records that have aged past compactAfterDays.
     Called automatically by merge() after every successful merge.
     Also safe to call manually on app boot to reclaim storage.

     Records are only purged if:
       1. _deleted is true
       2. updated_at is older than compactAfterDays
     This preserves recently-deleted records long enough for any
     offline device to receive the deletion before it disappears.

     Set compactAfterDays: 0 in define() to disable compaction
     for a specific collection (e.g. audit logs you want to keep).

     Returns { purged } — number of records removed.
  ══════════════════════════════════════════════════════════ */
  function compact(collection) {
    _guardDefined(collection);

    const schema = _collections[collection];

    // Compaction disabled for this collection
    if (!schema.compactAfterDays) return { purged: 0 };

    const cutoff  = Date.now() - (schema.compactAfterDays * 24 * 60 * 60 * 1000);
    const records = _load(collection);
    const before  = records.length;

    const live = records.filter(r => {
      if (!r._deleted) return true;
      // Keep recently deleted — another device may not have seen it yet
      const age = new Date(r.updated_at || r.created_at).getTime();
      return age > cutoff;
    });

    const purged = before - live.length;
    if (purged > 0) {
      _persist(collection, live);
      // No _notify() — compaction is invisible to the UI.
      // Deleted records are already filtered out of query() results.
    }

    return { purged };
  }

  /* ── Guards ───────────────────────────────────────────────── */

  function _guardReady(collection) {
    if (!_identity.company_id || !_identity.app_id) {
      throw new Error('[gnoke-store] Call GnokeStore.configure() with company_id and app_id before any read or write.');
    }

    if (!collection) return; // called without collection — base check only

    const schema = _collections[collection];
    if (!schema) return;    // _guardDefined handles the missing schema case

    // Scope-aware checks — catch malformed keys before they silently persist
    if ((schema.scope === 'workspace' || schema.scope === 'user') && !_identity.workspace_id) {
      throw new Error(`[gnoke-store] Collection "${collection}" has scope "${schema.scope}" but workspace_id is not set. Call GnokeStore.configure({ workspace_id }) after workspace resolves.`);
    }

    if (schema.scope === 'user' && !_identity.user_id) {
      throw new Error(`[gnoke-store] Collection "${collection}" has scope "user" but user_id is not set. Call GnokeStore.configure({ user_id }) after onboarding or restore completes.`);
    }
  }

  function _guardDefined(collection) {
    if (!_collections[collection]) {
      throw new Error(`[gnoke-store] Collection "${collection}" is not defined. Call GnokeStore.define("${collection}", { ... }) first.`);
    }
  }

  /* ── Export ───────────────────────────────────────────────── */

  const GnokeStore = Object.freeze({
    configure,
    define,
    save,
    update,
    remove,
    query,
    getOne,
    onChange,
    merge,
    compact,
    isReady,
    getDefinedCollections,
    getSchema,
    getIdentity,
  });

  root.GnokeStore = GnokeStore;

})(window);

