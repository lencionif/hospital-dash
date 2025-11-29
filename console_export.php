<?php
// console_export.php — recibe logs de consola y los agrega a test-results/error.log

date_default_timezone_set('Europe/Madrid');

$logDir = __DIR__ . '/test-results';
if (!is_dir($logDir)) {
    mkdir($logDir, 0777, true);
}

$logFile = $logDir . '/error.log';

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

$timestamp = date('Y-m-d H:i:s');
$level     = isset($data['level']) ? $data['level'] : 'log';
$message   = isset($data['message']) ? $data['message'] : '';
$meta      = array_key_exists('meta', (array)$data) ? $data['meta'] : null;

$entry = [
    'timestamp' => $timestamp,
    'level'     => $level,
    'message'   => $message,
    'meta'      => $meta,
];

$line = json_encode($entry, JSON_UNESCAPED_UNICODE) . PHP_EOL;
file_put_contents($logFile, $line, FILE_APPEND);

header('Content-Type: application/json');
echo json_encode(['status' => 'ok']);
