<?php
// debug-export.php – recibe mapas ASCII y los almacena para depuración
header('Content-Type: application/json');

$outputFile = __DIR__ . '/test-results/debug-load.txt';
$separator  = str_repeat('=', 32);

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

    $entryLines = [];
    $entryLines[] = $separator;
    $entryLines[] = 'timestamp = ' . date('c');

    $fields = [
        'levelId', 'mode', 'width', 'height', 'cooling', 'seed'
    ];

    foreach ($fields as $field) {
        if (array_key_exists($field, $meta) && $meta[$field] !== '' && $meta[$field] !== null) {
          $entryLines[] = str_pad($field, 9, ' ', STR_PAD_RIGHT) . ' = ' . $meta[$field];
        }
    }

    // Añadir cualquier otro metadato útil
    foreach ($meta as $key => $value) {
        if (in_array($key, $fields, true)) {
            continue;
        }
        if (is_scalar($value) || $value === null) {
            $entryLines[] = str_pad((string)$key, 9, ' ', STR_PAD_RIGHT) . ' = ' . ($value === null ? 'null' : $value);
        } else {
            $entryLines[] = str_pad((string)$key, 9, ' ', STR_PAD_RIGHT) . ' = ' . json_encode($value);
        }
    }

    $entryLines[] = 'source    = level_rules.xml';
    $entryLines[] = '';

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
