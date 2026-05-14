<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  gnoke/core.php  — FROZEN — do not edit.                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Single-tenant DB connection + schema migration + shared helpers.
 * One company → one database file → no routing, no index DB.
 */

// ── Response helpers ──────────────────────────────────────────

function ok(array $data = []): void {
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}

function require_method(string $m): void {
    if ($_SERVER['REQUEST_METHOD'] !== $m) fail("Use $m for this action", 405);
}

function body(): array {
    static $b;
    if ($b !== null) return $b;
    $b = json_decode(file_get_contents('php://input'), true) ?? [];
    return $b;
}

function now_iso(): string { return gmdate('Y-m-d\TH:i:s\Z'); }
function gen_id(int $bytes = 16): string { return bin2hex(random_bytes($bytes)); }

// ── Database ──────────────────────────────────────────────────
// Single connection. DB_PATH is the only thing that changes per deployment.

function db(): PDO {
    static $pdo;
    if ($pdo) return $pdo;

    $path = DB_PATH;
    $dir  = dirname($path);

    if (!is_dir($dir)) {
        if (!mkdir($dir, 0750, true)) {
            fail('Cannot create database directory: ' . $dir . ' — check server write permissions', 500);
        }
        file_put_contents($dir . '/.htaccess', "Deny from all\n");
    }

    try {
        $pdo = new PDO('sqlite:' . $path);
    } catch (PDOException $e) {
        fail('Database error: ' . $e->getMessage(), 500);
    }

    $pdo->setAttribute(PDO::ATTR_ERRMODE,            PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA synchronous  = NORMAL');

    gnoke_migrate($pdo);

    return $pdo;
}

// ── Schema migration ──────────────────────────────────────────
// Runs once on first connection. Safe to call repeatedly (CREATE IF NOT EXISTS).

function gnoke_migrate(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS profiles (
            user_id      TEXT NOT NULL PRIMARY KEY,
            workspace_id TEXT NOT NULL DEFAULT '',
            name         TEXT NOT NULL DEFAULT '',
            phone        TEXT NOT NULL DEFAULT '',
            email        TEXT NOT NULL DEFAULT '',
            role         TEXT NOT NULL DEFAULT 'user',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_profile_phone ON profiles (phone);
        CREATE INDEX IF NOT EXISTS idx_profile_email ON profiles (email);

        CREATE TABLE IF NOT EXISTS tokens (
            token      TEXT NOT NULL PRIMARY KEY,
            user_id    TEXT NOT NULL,
            device_id  TEXT NOT NULL,
            revoked    INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens (user_id, revoked);

        CREATE TABLE IF NOT EXISTS records (
            id           TEXT NOT NULL,
            collection   TEXT NOT NULL,
            workspace_id TEXT NOT NULL DEFAULT '',
            user_id      TEXT NOT NULL DEFAULT '',
            data         TEXT,
            deleted      INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            PRIMARY KEY (id, collection)
        );
        CREATE INDEX IF NOT EXISTS idx_collection
            ON records (collection, deleted, updated_at);
        CREATE INDEX IF NOT EXISTS idx_workspace_collection
            ON records (workspace_id, collection, deleted);
        CREATE INDEX IF NOT EXISTS idx_user_collection
            ON records (user_id, collection, deleted);

        CREATE TABLE IF NOT EXISTS otps (
            otp        TEXT NOT NULL PRIMARY KEY,
            user_id    TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used       INTEGER NOT NULL DEFAULT 0
        );
    ");
}
