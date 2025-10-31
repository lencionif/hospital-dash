(() => {
  'use strict';

  const TILE = 32;

  const SYMBOLS = {
    '#': 'wall',
    '.': 'floor',
    'H': 'hero',
    'g': 'pill',
    'p': 'patient',
    'C': 'cart',
    'r': 'rat',
    'm': 'mosquito',
    'd': 'door',
    'B': 'boss',
    'E': 'elevator',
    't': 'hazard'
  };

  const debugLayout = [
    '########################',
    '#H..E.g......C.........#',
    '#......................#',
    '#.........#####........#',
    '#.........#..r#........#',
    '#...p.....#...#....m...#',
    '#.........#...#........#',
    '#.........#t..#..dB....#',
    '#.........#####........#',
    '########################'
  ];

  function createEmptyMap(width, height) {
    return new Array(width * height).fill('floor');
  }

  function worldPos(col, row) {
    return {
      x: (col + 0.5) * TILE,
      y: (row + 0.5) * TILE
    };
  }

  function parseLayout(layout) {
    const height = layout.length;
    const width = layout[0].length;
    const tiles = createEmptyMap(width, height);

    const spawns = {
      hero: null,
      pills: [],
      patients: [],
      carts: [],
      rats: [],
      mosquitoes: [],
      doors: [],
      hazards: [],
      elevators: [],
      boss: null
    };

    layout.forEach((rowString, row) => {
      for (let col = 0; col < rowString.length; col++) {
        const symbol = rowString[col];
        const tileIndex = row * width + col;
        const type = SYMBOLS[symbol] || 'floor';
        tiles[tileIndex] = type === 'wall' ? 'wall' : 'floor';
        const pos = worldPos(col, row);
        switch (type) {
          case 'hero':
            spawns.hero = pos;
            break;
          case 'pill':
            spawns.pills.push(pos);
            break;
          case 'patient':
            spawns.patients.push(pos);
            break;
          case 'cart':
            spawns.carts.push(pos);
            break;
          case 'rat':
            spawns.rats.push(pos);
            break;
          case 'mosquito':
            spawns.mosquitoes.push(pos);
            break;
          case 'door':
            spawns.doors.push(pos);
            break;
          case 'hazard':
            spawns.hazards.push(pos);
            break;
          case 'elevator':
            spawns.elevators.push(pos);
            break;
          case 'boss':
            spawns.boss = pos;
            break;
        }
      }
    });

    return {
      width,
      height,
      tileSize: TILE,
      tiles,
      spawns
    };
  }

  const MapGen = {
    createDebugMap() {
      return parseLayout(debugLayout);
    },
    isWall(map, col, row) {
      if (!map) return false;
      if (col < 0 || row < 0 || col >= map.width || row >= map.height) return true;
      return map.tiles[row * map.width + col] === 'wall';
    },
    tileAt(map, x, y) {
      if (!map) return 'void';
      const col = Math.floor(x / map.tileSize);
      const row = Math.floor(y / map.tileSize);
      if (col < 0 || row < 0 || col >= map.width || row >= map.height) return 'void';
      return map.tiles[row * map.width + col];
    }
  };

  window.MapGen = MapGen;
})();
