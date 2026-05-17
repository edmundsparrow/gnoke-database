<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  data.php  — FROZEN — do not edit.                    ║
 * ║  Merges: records · sync                                     ║
 * ║  Evolution of api.php v1 → gnoke-sync-lite v2 → engine v3  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Generic CRUD + sync layer. Works for any collection name you
 * define — patients, harvests, shipments, students, messages…
 * The engine doesn't care what lives inside `data`; it just stores
 * and returns it. Payload validation belongs in gnoke-config.php
 * via SCHEMAS (optional — leave empty to accept anything).
 */

// ══════════════════════════════════════════════════════════════
//  SECTION 1 — CRUD  (was records.php)
// ══════════════════════════════════════════════════════════════

function handle_save(array $t): void {
    require_method('POST');
    $b = body();

    $collection = trim($b['collection'] ?? ''); if (!$collection)  fail('collection required');
    if (!isset($b['data']))                                         fail('data required');

    // Optional payload validation — define SCHEMAS in gnoke-config.php
    // e.g. define('SCHEMAS', ['lab_result' => ['patient_id','test_type','value']]);
    if (defined('SCHEMAS') && SCHEMAS) {
        $schemas = SCHEMAS;
        if (isset($schemas[$collection])) {
            foreach ($schemas[$collection] as $required_field) {
                if (!isset($b['data'][$required_field]))
                    fail("Missing required field '{$required_field}' for collection '{$collection}'");
            }
        }
    }

    $id   = trim($b['id'] ?? '') ?: ('r_' . gen_id(12));
    $now  = now_iso();
    $json = json_encode($b['data'], JSON_UNESCAPED_UNICODE);

    db()->prepare("
        INSERT INTO records (id, collection, workspace_id, user_id, data, deleted, created_at, updated_at)
        VALUES (:id, :col, :ws, :uid, :data, 0, :now, :now)
        ON CONFLICT(id, collection) DO UPDATE SET
            data=excluded.data,
            workspace_id=excluded.workspace_id,
            user_id=excluded.user_id,
            deleted=0,
            updated_at=excluded.updated_at
    ")->execute([
        ':id'   => $id,
        ':col'  => $collection,
        ':ws'   => $b['workspace_id'] ?? $t['user_id'] ?? '',
        ':uid'  => $b['user_id']      ?? $t['user_id'] ?? '',
        ':data' => $json,
        ':now'  => $now,
    ]);

    ok(['id' => $id, 'updated_at' => $now]);
}

function handle_save_many(array $t): void {
    require_method('POST');
    $b = body();

    $records = $b['records'] ?? [];
    if (!is_array($records) || !$records) fail('records array required');
    if (count($records) > BATCH_LIMIT)    fail('Max ' . BATCH_LIMIT . ' per batch');

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

    foreach ($records as $rec) {
        if (empty($rec['collection']) || !isset($rec['data'])) continue;
        $id = trim($rec['id'] ?? '') ?: ('r_' . gen_id(12));
        $stmt->execute([
            ':id'   => $id,
            ':col'  => $rec['collection'],
            ':ws'   => $rec['workspace_id'] ?? $t['user_id'] ?? '',
            ':uid'  => $rec['user_id']      ?? $t['user_id'] ?? '',
            ':data' => json_encode($rec['data'], JSON_UNESCAPED_UNICODE),
            ':now'  => $now,
        ]);
        $ids[] = $id;
    }

    ok(['saved' => count($ids), 'ids' => $ids]);
}

function handle_get(array $t): void {
    require_method('GET');

    $collection = trim($_GET['collection'] ?? '');
    if (!$collection) fail('collection required');

    $where  = ['collection=:col', 'deleted=0'];
    $params = [':col' => $collection];

    if (!empty($_GET['id']))           { $where[] = 'id=:id';           $params[':id']    = $_GET['id']; }
    if (!empty($_GET['workspace_id'])) { $where[] = 'workspace_id=:ws'; $params[':ws']    = $_GET['workspace_id']; }
    if (!empty($_GET['user_id']))      { $where[] = 'user_id=:uid';     $params[':uid']   = $_GET['user_id']; }
    if (!empty($_GET['since']))        { $where[] = 'updated_at>:since';$params[':since'] = $_GET['since']; }

    // Per-field JSON filters: ?filter[status]=active  ?filter[amount_gte]=500
    foreach (($_GET['filter'] ?? []) as $raw_key => $val) {
        if ($val === '' || $val === null) continue;

        $op    = '=';
        $field = $raw_key;

        if      (substr($field, -4) === '_gte')  { $op = '>=';   $field = substr($field, 0, -4); }
        elseif  (substr($field, -4) === '_lte')  { $op = '<=';   $field = substr($field, 0, -4); }
        elseif  (substr($field, -3) === '_gt')   { $op = '>';    $field = substr($field, 0, -3); }
        elseif  (substr($field, -3) === '_lt')   { $op = '<';    $field = substr($field, 0, -3); }
        elseif  (substr($field, -5) === '_like') { $op = 'LIKE'; $field = substr($field, 0, -5); }

        if (!preg_match('/^\w+$/', $field)) continue;

        $ph      = ':jf_' . preg_replace('/\W+/', '_', $raw_key);
        $extract = "json_extract(data, '$.$field')";
        $col     = in_array($op, ['>', '<', '>=', '<='])
                     ? "CAST($extract AS REAL)"
                     : $extract;

        $where[]     = "$col $op $ph";
        $params[$ph] = $val;
    }

    $limit = min((int)($_GET['limit'] ?? 1000), 10000);
    $stmt  = db()->prepare(
        'SELECT * FROM records WHERE ' . implode(' AND ', $where) .
        ' ORDER BY updated_at DESC LIMIT ' . $limit
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) $row['data'] = json_decode($row['data'] ?? 'null', true);
    unset($row);

    ok(['records' => $rows, 'count' => count($rows)]);
}

function handle_delete(array $t): void {
    require_method('POST');
    $b = body();

    $collection = trim($b['collection'] ?? ''); if (!$collection) fail('collection required');
    $id         = trim($b['id']         ?? ''); if (!$id)         fail('id required');

    $st = db()->prepare("UPDATE records SET deleted=1, updated_at=? WHERE id=? AND collection=?");
    $st->execute([now_iso(), $id, $collection]);

    if (!$st->rowCount()) fail('Record not found', 404);
    ok(['deleted' => true, 'id' => $id]);
}

// ══════════════════════════════════════════════════════════════
//  SECTION 2 — SYNC  (was sync.php)
// ══════════════════════════════════════════════════════════════

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
