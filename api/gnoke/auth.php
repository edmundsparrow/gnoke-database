<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  gnoke/auth.php  — FROZEN — do not edit.                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Token issue, resolution, and revocation.
 * Single-tenant: tokens live in the one local DB — no index routing.
 */

function resolve_token(): array {
    $raw   = $_SERVER['HTTP_X_SYNC_TOKEN']      ?? '';
    $raw   = $raw ?: ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    $raw   = $raw ?: ($_SERVER['HTTP_X_GNOKE_TOKEN']  ?? '');
    $raw   = $raw ?: (body()['token']                 ?? '');
    $token = trim(str_replace('Bearer ', '', $raw));

    if (!$token) fail('No token — include X-Sync-Token: <token>', 401);

    $st = db()->prepare("SELECT * FROM tokens WHERE token=? AND revoked=0");
    $st->execute([$token]);
    $t = $st->fetch();

    if (!$t) fail('Invalid or revoked token', 401);
    return $t;
}

function require_admin(): void {
    $secret = body()['admin_secret'] ?? '';
    if (!hash_equals(ADMIN_SECRET, $secret)) fail('Bad admin secret', 403);
}

function issue_token(string $user_id, string $device_id): string {
    $token = gen_id(32);
    db()->prepare("INSERT INTO tokens (token, user_id, device_id, created_at) VALUES (?,?,?,?)")
        ->execute([$token, $user_id, $device_id, now_iso()]);
    return $token;
}
