#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const levelArg = parseInt(process.argv[2] || '1', 10) || 1;
const widthArg = parseInt(process.argv[3] || '0', 10) || 0;
const heightArg = parseInt(process.argv[4] || '0', 10) || 0;
const seedArg = process.argv[5] && process.argv[5] !== 'auto'
  ? process.argv[5]
  : Date.now();

// Minimal browser-like globals
if (!global.window) global.window = globalThis;
global.window.location = global.window.location || { search: '' };
global.window.console = console;
global.window.G = global.window.G || {};
global.window.TILE_SIZE = global.window.TILE_SIZE || 32;
global.location = global.window.location;

const mapgenPath = path.join(__dirname, '..', 'assets', 'plugins', 'mapgen.plugin.js');
const script = fs.readFileSync(mapgenPath, 'utf8');
const originalLog = console.log;
console.log = () => {};
// eslint-disable-next-line no-new-func
Function(script).call(globalThis);
console.log = originalLog;

if (typeof MapGen?.generate !== 'function') {
  console.error('MapGen.generate no disponible');
  process.exit(2);
}

(async () => {
  const result = await MapGen.generate(levelArg, { w: widthArg, h: heightArg, seed: seedArg });
  const spawn = Array.isArray(result.placements)
    ? result.placements.find((p) => p && (p.kind === 'start' || p.kind === 'player' || p.kind === 'hero'))
    : null;

  const payload = {
    width: result.width,
    height: result.height,
    ascii: result.ascii,
    areas: result.areas || null,
    control: result.areas?.control || null,
    spawn: spawn || null,
    charset: result.charset || null,
    seed: result.seed,
  };

  process.stdout.write(JSON.stringify(payload));
})();
