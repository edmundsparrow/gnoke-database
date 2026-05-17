<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  engine.php  — FROZEN — do not edit.                  ║
 * ║  Merges: core · auth · roles · identity · admin             ║
 * ║  Evolution of api.php v1 → gnoke-sync-lite v2 → engine v3  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Self-contained identity + access layer for any record-keeping app.
 * Medical, agriculture, logistics, education, chat — same engine.
 * The only thing that changes per deployment is gnoke-config.php.
 */

// ══════════════════════════════════════════════════════════════
//  SECTION 1 — RESPONSE + UTILITY HELPERS  (was core.php)
// ══════════════════════════════════════════════════════════════

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

// ── Database — one connection, one file, one deployment ───────

function db(): PDO {
    static $pdo;
    if ($pdo) return $pdo;

    $path = DB_PATH;
    $dir  = dirname($path);

    if (!is_dir($dir)) {
        if (!mkdir($dir, 0750, true))
            fail('Cannot create database directory: ' . $dir . ' — check server write permissions', 500);
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

    _migrate($pdo);
    return $pdo;
}

// ── Schema — universal 4-table layout for any app domain ──────
//  profiles  → who users are
//  tokens    → session keys
//  records   → every entity (patients, crops, parcels, students…)
//  otps      → one-time PIN codes

function _migrate(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS profiles (
            user_id       TEXT NOT NULL PRIMARY KEY,
            workspace_id  TEXT NOT NULL DEFAULT '',
            name          TEXT NOT NULL DEFAULT '',
            phone         TEXT NOT NULL DEFAULT '',
            email         TEXT NOT NULL DEFAULT '',
            role          TEXT NOT NULL DEFAULT 'user',
            device_id     TEXT NOT NULL DEFAULT '',
            device_id_alt TEXT NOT NULL DEFAULT '',
            canonical     TEXT NOT NULL DEFAULT '',
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
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
            user_id    TEXT,
            expires_at TEXT NOT NULL,
            used       INTEGER NOT NULL DEFAULT 0,
            type       TEXT NOT NULL DEFAULT 'restore'
        );
    ");
    // Safe forward-migration for existing deployments
    foreach ([
        "ALTER TABLE profiles ADD COLUMN device_id     TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE profiles ADD COLUMN canonical     TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE profiles ADD COLUMN device_id_alt TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE otps ADD COLUMN type TEXT NOT NULL DEFAULT 'restore'",
    ] as $sql) {
        try { $pdo->exec($sql); } catch (Exception $e) { /* column already exists */ }
    }
}

// ══════════════════════════════════════════════════════════════
//  SECTION 2 — AUTH  (was auth.php)
// ══════════════════════════════════════════════════════════════

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
    // Check both header (for GET) and body (for POST)
    $secret = $_SERVER['HTTP_X_ADMIN_SECRET'] ?? body()['admin_secret'] ?? '';
    if (!hash_equals(ADMIN_SECRET, $secret)) fail('Bad admin secret', 403);
}

function issue_token(string $user_id, string $device_id): string {
    $token = gen_id(32);
    db()->prepare("INSERT INTO tokens (token, user_id, device_id, created_at) VALUES (?,?,?,?)")
        ->execute([$token, $user_id, $device_id, now_iso()]);
    return $token;
}

// ══════════════════════════════════════════════════════════════
//  SECTION 3 — ROLES  (was roles.php)
// ══════════════════════════════════════════════════════════════
//
//  Configure the ROLES map in gnoke-config.php.
//  If ROLES is empty → all authenticated requests pass through.
//
//  Examples that work with zero code change:
//    Medical:     'doctor' => ['*'],  'technician' => ['save','get']
//    Agriculture: 'farmer' => ['save','get'], 'inspector' => ['*']
//    Logistics:   'rider'  => ['dispatch','save'], 'ops' => ['*']
//    Education:   'student'=> ['get'], 'teacher' => ['save','get','delete']
//    Chat:        'member' => ['save','get','dispatch','updates']

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
    return in_array('*', $perms, true) || in_array($action, $perms, true);
}

function require_role(array $token, string $action): void {
    if (!defined('ROLES') || empty(ROLES)) return;
    $role = resolve_role($token);
    if (!role_can($role, $action))
        fail("Role '{$role}' is not permitted to perform '{$action}'", 403);
}

// ══════════════════════════════════════════════════════════════
//  SECTION 4 — IDENTITY  (was identity.php)
// ══════════════════════════════════════════════════════════════

function handle_register(): void {
    require_method('POST');
    $b = body();

    $phone         = trim($b['phone']         ?? '');
    $email         = trim($b['email']         ?? '');
    $device_id     = trim($b['device_id']     ?? ''); if (!$device_id)  fail('device_id required');
    $device_id_alt = trim($b['device_id_alt'] ?? '');
    $reg_secret    = trim($b['reg_secret']    ?? ''); if (!$reg_secret) fail('reg_secret required');

    if ($reg_secret !== GNOKE_REG_SECRET) fail('Invalid registration code', 401);

    $identifier = $phone ?: $email;
    if (!$identifier) fail('phone or email required');

    $workspace_id = trim($b['workspace_id'] ?? '');
    $name         = trim($b['name']         ?? '');
    $role         = trim($b['role']         ?? 'operator');
    $now          = now_iso();
    $canonical    = strtolower($email ?: $phone);

    $col = $phone ? 'phone' : 'email';
    $st  = db()->prepare("SELECT user_id FROM profiles WHERE {$col}=?");
    $st->execute([$phone ?: $email]);
    if ($st->fetch()) fail('An account with this identifier already exists', 409);

    $user_id = 'u_' . gen_id(12);
    db()->prepare("
        INSERT INTO profiles
            (user_id, workspace_id, name, phone, email, role, device_id, device_id_alt, canonical, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ")->execute([$user_id, $workspace_id, $name, $phone, $email, $role, $device_id, $device_id_alt, $canonical, $now, $now]);

    $token = issue_token($user_id, $device_id);

    ok(['token' => $token, 'user_id' => $user_id, 'workspace_id' => $workspace_id, 'role' => $role]);
}

function handle_sign_in(): void {
    require_method('POST');
    $b = body();

    $phone     = trim($b['phone']     ?? '');
    $email     = trim($b['email']     ?? '');
    $device_id = trim($b['device_id'] ?? ''); if (!$device_id) fail('device_id required');

    $identifier = $phone ?: $email;
    if (!$identifier) fail('phone or email required');

    $col = $phone ? 'phone' : 'email';
    $st  = db()->prepare("SELECT * FROM profiles WHERE {$col}=?");
    $st->execute([$phone ?: $email]);
    $profile = $st->fetch();
    if (!$profile) fail('No account found. Please register first.', 404);

    $user_id = $profile['user_id'];

    if ($profile['device_id']) {
        $primary_ok = ($profile['device_id']     === $device_id);
        $alt_ok     = ($profile['device_id_alt'] && $profile['device_id_alt'] === $device_id);
        if (!$primary_ok && !$alt_ok) fail('Incorrect PIN.', 401);
    }

    $active = db()->prepare("SELECT token FROM tokens WHERE user_id=? AND device_id=? AND revoked=0");
    $active->execute([$user_id, $device_id]);
    $token = $active->fetchColumn() ?: issue_token($user_id, $device_id);

    ok([
        'token'        => $token,
        'user_id'      => $user_id,
        'workspace_id' => $profile['workspace_id'] ?? '',
        'role'         => $profile['role']         ?? 'operator',
        'name'         => $profile['name']         ?? '',
        'phone'        => $profile['phone']        ?? '',
        'email'        => $profile['email']        ?? '',
    ]);
}

// Legacy alias — gnoke-secure.js compatibility
function handle_save_profile(): void { handle_sign_in(); }

function handle_generate_otp(): void {
    require_method('POST');
    require_admin();
    $b = body();

    $user_id = trim($b['user_id'] ?? '');
    $phone   = trim($b['phone']   ?? '');
    $email   = trim($b['email']   ?? '');

    if ($user_id || $phone || $email) {
        // ── RESTORE: must resolve to an existing account ──────────
        if (!$user_id) {
            $col = $phone ? 'phone' : 'email';
            $st  = db()->prepare("SELECT user_id FROM profiles WHERE {$col}=?");
            $st->execute([$phone ?: $email]);
            $row = $st->fetch();
            if (!$row) fail('No account found for that identifier', 404);
            $user_id = $row['user_id'];
        }
        $type = 'restore';
        db()->prepare("DELETE FROM otps WHERE user_id=?")->execute([$user_id]);
    } else {
        // ── INVITE: blank OTP, no account needed yet ──────────────
        $type    = 'invite';
        $user_id = null;
    }

    $otp        = strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
    $expires_at = gmdate('Y-m-d\TH:i:s\Z', time() + OTP_TTL);

    db()->prepare("INSERT INTO otps (otp, user_id, expires_at, used, type) VALUES (?,?,?,0,?)")
        ->execute([$otp, $user_id, $expires_at, $type]);

    ok(['otp' => $otp, 'expires_at' => $expires_at, 'type' => $type]);
}

function handle_redeem_otp(): void {
    require_method('POST');
    $b = body();

    $otp       = strtoupper(trim($b['otp']       ?? '')); if (!$otp)       fail('otp required');
    $device_id = trim($b['device_id']             ?? ''); if (!$device_id) fail('device_id required');

    $st = db()->prepare("SELECT * FROM otps WHERE otp=? AND used=0");
    $st->execute([$otp]);
    $row = $st->fetch();

    if (!$row)                          fail('Invalid OTP', 401);
    if ($row['expires_at'] < now_iso()) fail('OTP expired',  401);

    db()->prepare("UPDATE otps SET used=1 WHERE otp=?")->execute([$otp]);

    // ── INVITE: create new account, role always operator ─────────
    if (($row['type'] ?? 'restore') === 'invite') {
        $phone  = trim($b['phone']        ?? '');
        $email  = trim($b['email']        ?? '');
        $name   = trim($b['name']         ?? '');
        $branch = trim($b['workspace_id'] ?? '');

        if (!$phone && !$email) fail('phone or email required');

        $col = $phone ? 'phone' : 'email';
        $chk = db()->prepare("SELECT user_id FROM profiles WHERE {$col}=?");
        $chk->execute([$phone ?: $email]);
        if ($chk->fetch()) fail('An account with this identifier already exists', 409);

        $user_id       = 'u_' . gen_id(12);
        $canonical     = strtolower($email ?: $phone);
        $alt           = ($phone && $email) ? strtolower($phone) : '';
        $device_id_alt = $alt ? '' : ''; // alt hash not available here; set empty
        $now           = now_iso();

        db()->prepare("
            INSERT INTO profiles
                (user_id, workspace_id, name, phone, email, role, device_id, device_id_alt, canonical, created_at, updated_at)
            VALUES (?,?,?,?,?,'operator',?,'',?,?,?)
        ")->execute([$user_id, $branch, $name, $phone, $email, $device_id, $canonical, $now, $now]);

        $token = issue_token($user_id, $device_id);
        $p = [
            'user_id'      => $user_id,
            'workspace_id' => $branch,
            'name'         => $name,
            'phone'        => $phone,
            'email'        => $email,
            'role'         => 'operator',
        ];
        ok(['token' => $token, 'user_id' => $user_id, 'profile' => $p]);
    }

    // ── RESTORE: update device on existing account ────────────────
    db()->prepare("UPDATE tokens SET revoked=1 WHERE user_id=?")->execute([$row['user_id']]);
    db()->prepare("UPDATE profiles SET device_id=?, device_id_alt='', updated_at=? WHERE user_id=?")
        ->execute([$device_id, now_iso(), $row['user_id']]);

    $token = issue_token($row['user_id'], $device_id);

    $profile = db()->prepare("SELECT * FROM profiles WHERE user_id=?");
    $profile->execute([$row['user_id']]);
    $p = $profile->fetch() ?: [];

    ok(['token' => $token, 'user_id' => $row['user_id'], 'profile' => $p]);
}

// ══════════════════════════════════════════════════════════════
//  SECTION 5 — ADMIN  (was admin.php)
// ══════════════════════════════════════════════════════════════

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

function handle_admin_profiles(): void {
    require_method('GET');
    require_admin();
    $rows = db()->query(
        "SELECT user_id, name, phone, email, workspace_id, role, created_at FROM profiles ORDER BY created_at DESC"
    )->fetchAll();
    ok(['profiles' => $rows, 'count' => count($rows)]);
}

function handle_admin_tokens(): void {
    require_method('GET');
    require_admin();
    $user_id = trim($_GET['user_id'] ?? '');
    if ($user_id) {
        $st = db()->prepare("SELECT token, device_id, created_at, revoked FROM tokens WHERE user_id=? ORDER BY created_at DESC");
        $st->execute([$user_id]);
    } else {
        $st = db()->query("SELECT user_id, token, device_id, created_at, revoked FROM tokens ORDER BY created_at DESC LIMIT 200");
    }
    ok(['tokens' => $st->fetchAll(), 'count' => $st->rowCount()]);
}

function handle_admin_records(): void {
    require_method('GET');
    require_admin();
    $collection = trim($_GET['collection'] ?? '');
    $limit      = min((int)($_GET['limit'] ?? 100), 1000);
    if ($collection) {
        $st = db()->prepare("SELECT * FROM records WHERE collection=? AND deleted=0 ORDER BY updated_at DESC LIMIT ?");
        $st->execute([$collection, $limit]);
        $rows = $st->fetchAll();
        foreach ($rows as &$row) $row['data'] = json_decode($row['data'] ?? 'null', true);
        unset($row);
        ok(['records' => $rows, 'count' => count($rows)]);
    } else {
        $st   = db()->query("SELECT collection, COUNT(*) as count FROM records WHERE deleted=0 GROUP BY collection ORDER BY collection");
        ok(['collections' => $st->fetchAll()]);
    }
}

function handle_admin_delete_record(): void {
    require_method('POST');
    require_admin();
    $b  = body();
    $id = trim($b['id'] ?? ''); if (!$id) fail('id required');
    db()->prepare("UPDATE records SET deleted=1, updated_at=? WHERE id=?")->execute([now_iso(), $id]);
    ok(['deleted' => true, 'id' => $id]);
}