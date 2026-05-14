<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  gnoke/admin.php  — FROZEN — do not edit.                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

function handle_ping(): void {
    $db_ok = false;
    try { db(); $db_ok = true; } catch (Throwable $e) {}
    ok([
        'version' => GNOKE_VERSION,
        'db'      => $db_ok,
        'time'    => now_iso(),
        'php'     => PHP_VERSION,
    ]);
}

function handle_revoke_token(): void {
    require_method('POST');
    require_admin();
    $b = body();

    $user_id   = trim($b['user_id']   ?? '');
    $device_id = trim($b['device_id'] ?? '');

    if (!$user_id && !$device_id) fail('user_id or device_id required');

    $where  = ['revoked=0'];
    $params = [];

    if ($user_id)   { $where[] = 'user_id=?';   $params[] = $user_id; }
    if ($device_id) { $where[] = 'device_id=?'; $params[] = $device_id; }

    db()->prepare('UPDATE tokens SET revoked=1 WHERE ' . implode(' AND ', $where))
        ->execute($params);

    ok(['revoked' => true]);
}
