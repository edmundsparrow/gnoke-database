<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  index.php  — GnokeEngine entry point.  FROZEN — do not edit ║
 * ║  Configure in gnoke-config.php only.                        ║
 * ║                                                             ║
 * ║  v1  api.php          — single file, hard-coded roles       ║
 * ║  v2  gnoke-sync-lite  — 7 files, modular but spread out     ║
 * ║  v3  gnoke-engine     — 5 files, 2 frozen modules           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 5-file layout
 * ─────────────────────────────────────────────────────────────
 *  index.php          ← you are here  (frozen router)
 *  /gnoke-config.php   ← ONLY file you edit per deployment
 *  /engine.php   ← identity · auth · roles · admin (frozen)
 *  /data.php     ← records · sync  (frozen)
 *  ../gnoke-config.js    ← frontend config (edit per deployment)
 * ─────────────────────────────────────────────────────────────
 */
define('GNOKE_VERSION', '3.0.0');

require_once __DIR__ . '/gnoke-config.php';
require_once __DIR__ . '/engine.php';
require_once __DIR__ . '/data.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Sync-Token, X-Gnoke-Token, X-Admin-Secret');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$action = trim($_GET['action'] ?? '');
if (!$action) fail('action param required');

try {
    switch ($action) {
        // ── Public ─────────────────────────────────────────────
        case 'ping':         handle_ping();                                                  break;
        case 'register':     handle_register();                                              break;
        case 'sign-in':      handle_sign_in();                                               break;
        case 'save-profile': handle_save_profile(); /* legacy — gnoke-secure.js compat */    break;
        case 'redeem-otp':   handle_redeem_otp();                                            break;

        // ── Admin-secret protected ─────────────────────────────
        case 'generate-otp':       handle_generate_otp();                            break;
        case 'revoke-token':       handle_revoke_token();                            break;
        case 'admin-profiles':     handle_admin_profiles();                          break;
        case 'admin-tokens':       handle_admin_tokens();                            break;
        case 'admin-records':      handle_admin_records();                           break;
        case 'admin-delete-record': handle_admin_delete_record();                    break;

        // ── Token + role protected ─────────────────────────────
        case 'dispatch':     $t = resolve_token(); require_role($t, 'dispatch');  handle_dispatch($t);  break;
        case 'updates':      $t = resolve_token(); require_role($t, 'updates');   handle_updates($t);   break;
        case 'save':         $t = resolve_token(); require_role($t, 'save');      handle_save($t);      break;
        case 'save-many':    $t = resolve_token(); require_role($t, 'save-many'); handle_save_many($t); break;
        case 'get':          $t = resolve_token(); require_role($t, 'get');       handle_get($t);       break;
        case 'delete':       $t = resolve_token(); require_role($t, 'delete');    handle_delete($t);    break;

        default:             fail("Unknown action: $action", 404);
    }
} catch (Throwable $e) {
    fail('Internal error: ' . $e->getMessage(), 500);
}