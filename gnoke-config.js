/* ─────────────────────────────────────────────────────────────
   gnoke-config.js  —  the only JS file you edit per project.
   Safe to load on index.html (login page) alone.
   Load AFTER gnoke-store.js and gnoke-sync.js on app pages.
   ───────────────────────────────────────────────────────────── */

// ── 1. Point to your API ──────────────────────────────────────
// This must match the URL where your /api/index.php lives.
const GNOKE_ENDPOINT = 'https://webapps.ct.ws/api/index.php';

// ── 2. Staff self-registration auth code ─────────────────────
// Staff must enter this code to self-register. Change before deploying.
const GNOKE_REG_SECRET = 'CHANGEME';

// ── 3 & 4 only run when the full engine is loaded (app pages) ─
if (window.GnokeStore) {

  // ── 3. Configure identity ───────────────────────────────────
  // company_id + app_id are single-tenant placeholders.
  // When gnoke-router ships for multi-tenant, replace with real values.
  // workspace_id and user_id are filled in by the engine after login.
  GnokeStore.configure({
    endpoint     : GNOKE_ENDPOINT,
    company_id   : 'default',   // placeholder — reserved for gnoke-router
    app_id       : 'app',       // placeholder — reserved for gnoke-router
    workspace_id : '',          // filled in after login
    user_id      : '',          // filled in after login
  });

  // ── 4. Register your collections ───────────────────────────
  // scope options:
  //   'user'      — private to the logged-in user
  //   'workspace' — shared across everyone in the same branch/group
  //   'company'   — shared across the whole deployment
  //
  // Add or remove collections to match your app's data model.

  GnokeStore.define('messages',   { scope: 'workspace' });
  GnokeStore.define('deliveries', { scope: 'user' });

}