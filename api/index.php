<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  index.php  — GnokeAPI entry point.  FROZEN — do not edit.  ║
 * ║  Configure in gnoke-config.php only.                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
define('GNOKE_VERSION', '2.0.0');

require_once __DIR__ . '/gnoke-config.php';
require_once __DIR__ . '/gnoke/core.php';
require_once __DIR__ . '/gnoke/auth.php';
require_once __DIR__ . '/gnoke/roles.php';
require_once __DIR__ . '/gnoke/identity.php';
require_once __DIR__ . '/gnoke/records.php';
require_once __DIR__ . '/gnoke/sync.php';
require_once __DIR__ . '/gnoke/admin.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Sync-Token, X-Gnoke-Token');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$action = trim($_GET['action'] ?? '');
if (!$action) fail('action param required');

try {
    switch ($action) {
        case 'ping':         handle_ping();                                         break;
        case 'save-profile': handle_save_profile();                                 break;
        case 'generate-otp': handle_generate_otp();                                 break;
        case 'redeem-otp':   handle_redeem_otp();                                   break;
        case 'revoke-token': handle_revoke_token();                                 break;
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
