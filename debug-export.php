<?php
// debug-export.php
// Guarda el volcado ASCII del mapa para depuración
$data = file_get_contents('php://input');

if (!$data) {
    http_response_code(400);
    echo "No data";
    exit;
}

$file = __DIR__ . '/debug-load.txt';
file_put_contents($file, $data);
echo "OK";
