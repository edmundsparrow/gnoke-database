<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  gnoke-config.php  — the ONLY file you edit per deployment. ║
 * ║  index.php is frozen. Configure everything here.            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * SINGLE-TENANT: one company, one database file, one deployment.
 * To reuse for a new client — copy the /api folder, edit this file, deploy.
 */

// ── Database ──────────────────────────────────────────────────
// Path to the SQLite file. Keep it OUTSIDE the web root if possible.
// The folder is auto-created on first request.
if (!defined('DB_PATH')) {
    define('DB_PATH', __DIR__ . '/gnoke-data/gnoke.db');
}

// ── Admin secret ──────────────────────────────────────────────
// Protects generate-otp and revoke-token. Never put this in frontend code.
define('ADMIN_SECRET', 'CHANGE_THIS_SECRET');

// ── Master collections ────────────────────────────────────────
// Collections fully owned by the server.
// On pull → these hard-overwrite the local copy on every device.
// Match names exactly to GnokeStore.define() in gnoke-config.js.
// e.g. ['products', 'locations'] — leave empty if unused.
define('MASTER_COLLECTIONS', json_encode([]));

// ── OTP expiry (seconds) ──────────────────────────────────────
define('OTP_TTL', 900);   // 15 minutes

// ── Batch limit ───────────────────────────────────────────────
define('BATCH_LIMIT', 500);

// ── Role map ──────────────────────────────────────────────────
// Map role names → allowed actions. '*' = all actions.
// Built-in actions: save · save-many · get · delete · dispatch · updates
// Leave empty to allow all authenticated requests through.
//
// Example:
// define('ROLES', [
//     'operator' => ['save', 'get', 'dispatch', 'updates'],
//     'admin'    => ['*'],
// ]);
define('ROLES', []);
