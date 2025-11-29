<?php
// debug-export.php – recibe mapas ASCII y los almacena para depuración
header('Content-Type: application/json');

$outputFile = __DIR__ . '/test-results/debug-load.txt';
$separator  = str_repeat('=', 32);

$jsonFlags = JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES;

try {
    $raw = file_get_contents('php://input');
    if ($raw === false) {
        throw new RuntimeException('No se pudo leer el cuerpo de la petición');
    }

    $meta = [];
    $ascii = '';

    $decoded = json_decode($raw, true);
    if (is_array($decoded) && json_last_error() === JSON_ERROR_NONE) {
        $meta = is_array($decoded['meta'] ?? null) ? $decoded['meta'] : [];
        $ascii = isset($decoded['ascii']) ? (string)$decoded['ascii'] : '';
    } else {
        // Compatibilidad: formato legacy en texto plano
        $ascii = (string)$raw;
    }

    $ascii = rtrim($ascii, "\r\n");
    $meta = is_array($meta) ? $meta : [];

    $timestamp = date('Y-m-d H:i:s');
    $levelData = is_array($meta['level'] ?? null) ? $meta['level'] : [];
    $globalsData = is_array($meta['globals'] ?? null) ? $meta['globals'] : [];
    $generationRaw = is_array($meta['generation'] ?? null) ? $meta['generation'] : [];
    $metaExtraBase = [];
    if (is_array($meta['meta_extra'] ?? null)) {
        $metaExtraBase = $meta['meta_extra'];
    } elseif (is_array($meta['metaExtra'] ?? null)) {
        $metaExtraBase = $meta['metaExtra'];
    }
    $metaExtra = array_merge($metaExtraBase, array_diff_key($meta, [
        'globals' => 1,
        'level' => 1,
        'rules' => 1,
        'generation' => 1,
        'meta_extra' => 1,
        'metaExtra' => 1,
    ]));

    $generationDefaults = [
        'roomsRequested'    => $meta['roomsRequested'] ?? $meta['rooms'] ?? ($levelData['rooms'] ?? null),
        'roomsGenerated'    => $meta['roomsGenerated'] ?? ($generationRaw['roomsGenerated'] ?? $meta['roomsCount'] ?? $generationRaw['roomsCount'] ?? null),
        'corridorWidthUsed' => $generationRaw['corridorWidthUsed'] ?? $meta['corridorWidth'] ?? $metaExtra['corridorWidthUsed'] ?? $generationRaw['corridorWidth'] ?? null,
        'culling'           => $meta['culling'] ?? $levelData['culling'] ?? $globalsData['culling'] ?? null,
        'cooling'           => $meta['cooling'] ?? $levelData['cooling'] ?? $globalsData['cooling'] ?? null,
        'bossReachable'     => $meta['bossReachable'] ?? $generationRaw['bossReachable'] ?? null,
        'allRoomsReachable' => $meta['allRoomsReachable'] ?? $generationRaw['allRoomsReachable'] ?? null,
        'floorPercent'      => $meta['floorPercent'] ?? $generationRaw['floorPercent'] ?? null,
        'walkableTiles'     => $meta['walkableTiles'] ?? $generationRaw['walkableTiles'] ?? null,
        'totalTiles'        => $meta['totalTiles'] ?? $generationRaw['totalTiles'] ?? null,
        'numCorridors'      => $meta['corridorsBuilt'] ?? $generationRaw['corridorsBuilt'] ?? $generationRaw['numCorridors'] ?? null,
    ];

    $generation = array_merge($generationDefaults, $generationRaw);

    $entryLines = [];
    $entryLines[] = $separator;
    $entryLines[] = 'timestamp: ' . $timestamp;
    if (array_key_exists('levelId', $meta)) $entryLines[] = 'levelId: ' . $meta['levelId'];
    if (array_key_exists('mode', $meta)) $entryLines[] = 'mode: ' . $meta['mode'];
    if (array_key_exists('seed', $meta)) $entryLines[] = 'seed: ' . $meta['seed'];
    $entryLines[] = 'source: level_rules.xml';
    $entryLines[] = '';
    $entryLines[] = '[globals]';
    $entryLines[] = json_encode($globalsData, $jsonFlags);
    $entryLines[] = '[level]';
    $entryLines[] = json_encode($levelData, $jsonFlags);
    $entryLines[] = '[rules]';
    $entryLines[] = json_encode($meta['rules'] ?? [], $jsonFlags);
    $entryLines[] = '[generation]';
    $entryLines[] = json_encode($generation, $jsonFlags);
    $entryLines[] = '[meta_extra]';
    $entryLines[] = json_encode($metaExtra, $jsonFlags);
    $entryLines[] = '[map]';
    if ($ascii !== '') {
        $entryLines[] = $ascii;
    }
    $entryLines[] = '';

    $entry = implode("\n", $entryLines);

    $dir = dirname($outputFile);
    if (!is_dir($dir)) {
        if (!mkdir($dir, 0777, true) && !is_dir($dir)) {
            throw new RuntimeException('No se pudo crear el directorio test-results');
        }
    }

    if (file_put_contents($outputFile, $entry, FILE_APPEND | LOCK_EX) === false) {
        throw new RuntimeException('No se pudo escribir en debug-load.txt');
    }

    echo json_encode(['ok' => true]);
    exit;
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
    exit;
}
