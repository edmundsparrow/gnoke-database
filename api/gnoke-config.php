<?php
/* ─────────────────────────────────────────────────────
   gnoke-config.php  —  the only PHP file you edit per deployment.
   index.php, engine.php and data.php are frozen.
   ───────────────────────────────────────────────────── */

// ── 1. Database ──────────────────────────────────────
define('DB_PATH', __DIR__ . '/gnoke-data/gnoke.db');

// ── 2. Secrets ───────────────────────────────────────
// GNOKE_REG_SECRET must match gnoke-config.js.
define('GNOKE_REG_SECRET', 'Test2026');
// ADMIN_SECRET is backend-only — never put in frontend.
define('ADMIN_SECRET',     'Advance2026');

// ── 3. Timing + limits ───────────────────────────────
define('OTP_TTL',     900);
define('BATCH_LIMIT', 500);

// ── 4. Master collections ────────────────────────────
define('MASTER_COLLECTIONS', json_encode([]));

// ── 5. Payload schemas (optional) ────────────────────
define('SCHEMAS', []);

// ── 6. Roles ─────────────────────────────────────────
// Empty = no role checks — all authenticated requests pass.
define('ROLES', []);
