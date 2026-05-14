<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  gnoke/sync.php  — FROZEN — do not edit.                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * dispatch  — staff push local events to the cloud DB.
 * updates   — devices pull server-side changes (master collections).
 */

function handle_dispatch(array $t): void {
    require_method('POST');
    $b = body();

    $workspace_id = trim($b['workspaceId'] ?? '');
    if (!$workspace_id) fail('workspaceId required');

    $events = $b['events'] ?? [];
    if (!is_array($events) || !$events) fail('events array required');
    if (count($events) > BATCH_LIMIT)   fail('Max ' . BATCH_LIMIT . ' per dispatch');

    $stmt = db()->prepare("
        INSERT INTO records (id, collection, workspace_id, user_id, data, deleted, created_at, updated_at)
        VALUES (:id, :col, :ws, :uid, :data, 0, :now, :now)
        ON CONFLICT(id, collection) DO UPDATE SET
            data=excluded.data,
            workspace_id=excluded.workspace_id,
            user_id=excluded.user_id,
            deleted=0,
            updated_at=excluded.updated_at
    ");

    $ids = [];
    $now = now_iso();

    foreach ($events as $parcel) {
        $collection = trim($parcel['entity'] ?? '');
        if (!$collection) continue;

        $data = array_merge($parcel['payload'] ?? [], [
            '_type' => $parcel['type'] ?? 'CREATE',
            '_ts'   => $parcel['ts']   ?? $now,
            '_dk'   => $parcel['dk']   ?? '',
        ]);

        $id = trim($parcel['id'] ?? '') ?: ('r_' . gen_id(12));

        $stmt->execute([
            ':id'   => $id,
            ':col'  => $collection,
            ':ws'   => $workspace_id,
            ':uid'  => $t['user_id'],
            ':data' => json_encode($data, JSON_UNESCAPED_UNICODE),
            ':now'  => $now,
        ]);
        $ids[] = $id;
    }

    ok(['saved' => count($ids), 'ids' => $ids]);
}

function handle_updates(array $t): void {
    require_method('GET');

    $workspace_id = trim($_GET['workspaceId'] ?? '');
    if (!$workspace_id) fail('workspaceId required');

    $master_collections = json_decode(MASTER_COLLECTIONS, true) ?: [];
    $result = [];

    foreach ($master_collections as $collection) {
        $st = db()->prepare("
            SELECT * FROM records
            WHERE workspace_id=? AND collection=? AND deleted=0
            ORDER BY updated_at DESC
        ");
        $st->execute([$workspace_id, $collection]);
        $rows = $st->fetchAll();

        foreach ($rows as &$row) {
            $row['data'] = json_decode($row['data'] ?? 'null', true);
        }
        unset($row);

        if ($rows) $result[$collection] = $rows;
    }

    ok(array_merge(['collections_returned' => count($result)], $result));
}
