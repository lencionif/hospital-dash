<?php
// debug_map.php – visor simple del histórico de mapas
$filePath = __DIR__ . '/test-results/debug-load.txt';
$separatorPattern = '/^=+$/m';

if (!file_exists($filePath)) {
    echo '<!doctype html><html><head><meta charset="utf-8"><title>Hospital Dash – Debug maps</title></head><body>';
    echo '<p>No hay mapas registrados todavía.</p>';
    echo '</body></html>';
    exit;
}

$content = file_get_contents($filePath);
if ($content === false) {
    echo '<!doctype html><html><head><meta charset="utf-8"><title>Hospital Dash – Debug maps</title></head><body>';
    echo '<p>Error al leer debug-load.txt.</p>';
    echo '</body></html>';
    exit;
}

$mapCount = 0;
if (preg_match_all($separatorPattern, $content, $matches)) {
    $mapCount = count($matches[0]);
}

?><!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Hospital Dash – Debug maps</title>
  <style>
    body { font-family: monospace; background: #0b0d10; color: #e6edf3; padding: 16px; }
    pre { background: #111418; padding: 12px; border: 1px solid #222; overflow: auto; }
  </style>
</head>
<body>
  <h1>Debug maps</h1>
  <p>Total de mapas detectados: <?php echo (int)$mapCount; ?></p>
  <pre><?php echo htmlspecialchars($content, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></pre>
</body>
</html>
