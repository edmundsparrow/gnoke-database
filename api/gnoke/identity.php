<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  gnoke/identity.php  — FROZEN — do not edit.                ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Profile registration / sign-in, OTP generation + redemption.
 * Identifier can be phone or email — whichever the client sends.
 */

function handle_save_profile(): void {
    require_method('POST');
    $b = body();

    // Accept phone or email as the login identifier
    $phone     = trim($b['phone']        ?? '');
    $email     = trim($b['email']        ?? '');
    $device_id = trim($b['device_id']    ?? ''); if (!$device_id) fail('device_id required');

    // At least one identifier required
    $identifier = $phone ?: $email;
    if (!$identifier) fail('phone or email required');

    $workspace_id = trim($b['workspace_id'] ?? '');
    $name         = trim($b['name']         ?? '');
    $role         = trim($b['role']         ?? 'user');
    $now          = now_iso();

    // Look up existing profile by phone or email
    if ($phone) {
        $st = db()->prepare("SELECT user_id FROM profiles WHERE phone=?");
        $st->execute([$phone]);
    } else {
        $st = db()->prepare("SELECT user_id FROM profiles WHERE email=?");
        $st->execute([$email]);
    }
    $row = $st->fetch();

    if ($row) {
        // Existing user — update mutable fields if provided
        $user_id = $row['user_id'];
        $existing = db()->prepare("SELECT name, workspace_id, role FROM profiles WHERE user_id=?");
        $existing->execute([$user_id]);
        $prev = $existing->fetch();

        db()->prepare("
            UPDATE profiles
            SET name=?, workspace_id=?, role=?, updated_at=?
            WHERE user_id=?
        ")->execute([
            $name         ?: ($prev['name']         ?? ''),
            $workspace_id ?: ($prev['workspace_id'] ?? ''),
            $role         ?: ($prev['role']         ?? 'user'),
            $now,
            $user_id,
        ]);
    } else {
        // New user
        $user_id = 'u_' . gen_id(12);
        db()->prepare("
            INSERT INTO profiles (user_id, workspace_id, name, phone, email, role, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
        ")->execute([$user_id, $workspace_id, $name, $phone, $email, $role, $now, $now]);
    }

    // Re-use existing active token for this device, or issue a new one
    $active = db()->prepare("SELECT token FROM tokens WHERE user_id=? AND device_id=? AND revoked=0");
    $active->execute([$user_id, $device_id]);
    $token = $active->fetchColumn() ?: issue_token($user_id, $device_id);

    // Return workspace_id so the client can hydrate GnokeStore
    $profile = db()->prepare("SELECT workspace_id, role FROM profiles WHERE user_id=?");
    $profile->execute([$user_id]);
    $p = $profile->fetch();

    ok([
        'token'        => $token,
        'user_id'      => $user_id,
        'workspace_id' => $p['workspace_id'] ?? $workspace_id,
        'role'         => $p['role']         ?? $role,
    ]);
}

function handle_generate_otp(): void {
    require_method('POST');
    require_admin();
    $b = body();

    $user_id = trim($b['user_id'] ?? ''); if (!$user_id) fail('user_id required');

    $otp        = strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
    $expires_at = gmdate('Y-m-d\TH:i:s\Z', time() + OTP_TTL);

    db()->prepare("DELETE FROM otps WHERE user_id=?")->execute([$user_id]);
    db()->prepare("INSERT INTO otps (otp, user_id, expires_at, used) VALUES (?,?,?,0)")
        ->execute([$otp, $user_id, $expires_at]);

    ok(['otp' => $otp, 'expires_at' => $expires_at]);
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
    if ($row['expires_at'] < now_iso()) fail('OTP expired', 401);

    db()->prepare("UPDATE otps SET used=1 WHERE otp=?")->execute([$otp]);

    $token = issue_token($row['user_id'], $device_id);

    $profile = db()->prepare("SELECT * FROM profiles WHERE user_id=?");
    $profile->execute([$row['user_id']]);
    $p = $profile->fetch() ?: [];

    ok(['token' => $token, 'user_id' => $row['user_id'], 'profile' => $p]);
}
