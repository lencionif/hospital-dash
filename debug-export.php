<?php
// Guarda el volcado ASCII del mapa para depuración
$data = file_get_contents('php://input');
file_put_contents(__DIR__ . '/debug-load.txt', $data);
