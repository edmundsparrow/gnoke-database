<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  gnoke/roles.php  — FROZEN — do not edit.                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Role enforcement. Configure the ROLES map in gnoke-config.php.
 * If ROLES is empty, all authenticated requests pass through.
 */

function resolve_role(array $token): string {
    if (!defined('ROLES') || empty(ROLES)) return 'user';

    $st = db()->prepare("SELECT role FROM profiles WHERE user_id=?");
    $st->execute([$token['user_id']]);
    $row = $st->fetch();

    return $row['role'] ?? 'user';
}

function role_can(string $role, string $action): bool {
    if (!defined('ROLES') || empty(ROLES)) return true;

    $map = ROLES;
    if (!isset($map[$role])) return false;

    $perms = $map[$role];
    if (in_array('*', $perms, true)) return true;

    return in_array($action, $perms, true);
}

function require_role(array $token, string $action): void {
    if (!defined('ROLES') || empty(ROLES)) return;

    $role = resolve_role($token);
    if (!role_can($role, $action)) {
        fail("Role '{$role}' is not permitted to perform '{$action}'", 403);
    }
}
