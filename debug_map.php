<?php
// debug_map.php
// Genera y valida el mapa ASCII normal usando level_rules.xml

function load_level_rules($levelId) {
    $xmlPath = __DIR__ . '/assets/config/level_rules.xml';
    if (!file_exists($xmlPath)) {
        throw new RuntimeException('No se encontró assets/config/level_rules.xml');
    }
    $doc = simplexml_load_file($xmlPath);
    foreach ($doc->level as $level) {
        $attrs = $level->attributes();
        if ((string)$attrs['id'] === (string)$levelId) {
            return $attrs;
        }
    }
    throw new RuntimeException("Level {$levelId} no encontrado en level_rules.xml");
}

function run_mapgen($levelId, $width, $height) {
    $cmd = [
        'node',
        __DIR__ . '/tools/mapgen-cli.js',
        $levelId,
        $width,
        $height,
        'auto'
    ];
    $descriptorSpec = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $process = proc_open($cmd, $descriptorSpec, $pipes);
    if (!is_resource($process)) {
        throw new RuntimeException('No se pudo lanzar mapgen-cli');
    }
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exit = proc_close($process);
    if ($exit !== 0) {
        throw new RuntimeException("mapgen-cli error ({$exit}): {$stderr}");
    }
    $json = json_decode($stdout, true);
    if (!is_array($json) || empty($json['ascii'])) {
        throw new RuntimeException('mapgen-cli devolvió una salida vacía o inválida');
    }
    return $json;
}

function validate_ascii(array $lines, $expectedW, $expectedH) {
    $messages = [];
    $rowCount = count($lines);
    if ($rowCount !== (int)$expectedH) {
        $messages[] = "ERROR: height {$rowCount} != {$expectedH}";
    }
    $expectedLen = $expectedW;
    foreach ($lines as $y => $line) {
        $len = strlen($line);
        if ($len !== $expectedLen) {
            $messages[] = "ERROR: row {$y} has length {$len} != {$expectedLen}";
        }
        $chars = preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY);
        if ($chars) {
            foreach ($chars as $x => $ch) {
                if ($ch === '' || $ch === null) {
                    $messages[] = "ERROR: empty char at {$x},{$y}";
                    break;
                }
            }
        }
    }
    return $messages;
}

function detect_spawn(array $lines, $startChar = 'S') {
    foreach ($lines as $y => $line) {
        $x = strpos($line, $startChar);
        if ($x !== false) {
            return ['x' => $x, 'y' => $y];
        }
    }
    return null;
}

function write_report($header, array $lines, array $messages, $control, $spawn) {
    $dir = __DIR__ . '/test-results';
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }
    $timestamp = date('Ymd_His');
    $file = sprintf('%s/debug-load_%s.txt', $dir, $timestamp);
    $content = [];
    $content[] = $header;
    if ($control) {
        $content[] = sprintf('CONTROL x=%d y=%d w=%d h=%d', $control['x'] ?? -1, $control['y'] ?? -1, $control['w'] ?? -1, $control['h'] ?? -1);
    }
    if ($spawn) {
        $content[] = sprintf('SPAWN x=%d y=%d', $spawn['x'] ?? -1, $spawn['y'] ?? -1);
    }
    $content = array_merge($content, $messages, $lines);
    file_put_contents($file, implode("\n", $content));
    return $file;
}

$levelParam = isset($_GET['lvl']) ? (int)$_GET['lvl'] : 1;
$levelAttrs = load_level_rules($levelParam);
$width = (int)$levelAttrs['width'];
$height = (int)$levelAttrs['height'];
$result = run_mapgen($levelParam, $width, $height);
$ascii = str_replace("\r", '', $result['ascii']);
$lines = explode("\n", trim($ascii, "\n"));
$messages = validate_ascii($lines, $width, $height);
$detectedSpawn = detect_spawn($lines);
if ($result['width'] !== $width || $result['height'] !== $height) {
    $messages[] = sprintf('ERROR: level_rules.xml=%dx%d but mapgen returned %dx%d', $width, $height, $result['width'], $result['height']);
}
$header = sprintf('LEVEL=%s W=%d H=%d', (string)$levelAttrs['id'], $result['width'], $result['height']);
$control = is_array($result['control'] ?? null) ? $result['control'] : null;
$spawn = is_array($result['spawn'] ?? null) ? $result['spawn'] : $detectedSpawn;
$file = write_report($header, $lines, $messages, $control, $spawn);

echo "Mapa generado en {$file}\n";
