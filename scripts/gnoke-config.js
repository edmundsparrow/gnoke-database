/* ─────────────────────────────────────────────────────
   gnoke-config.js  —  the only JS file you edit per project.
   Load AFTER gnoke-store.js on app pages.
   ───────────────────────────────────────────────────── */

// ── 1. API endpoint ──────────────────────────────────
const GNOKE_ENDPOINT = 'https://example.com/api/index.php';

// ── 2. Staff self-registration code ──────────────────
// Must match GNOKE_REG_SECRET in gnoke-config.php.
const GNOKE_REG_SECRET = 'Test2026';

// ── 3. Workspaces / Branches ─────────────────────────
const GNOKE_WORKSPACES = [];

// ── 4 & 5 only run when the full engine is loaded ────
if (window.GnokeStore) {

  // ── 4. Configure identity ───────────────────────────
  GnokeStore.configure({
    endpoint     : GNOKE_ENDPOINT,
    company_id   : 'default',
    app_id       : 'app',
    workspace_id : '',  // filled in after login
    user_id      : '',  // filled in after login
  });

}
