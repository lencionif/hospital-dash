// === mapgen.plugin.js ===
(function(){
  const MAPS = {
    tutorial: {
      tiles: [
        '####################',
        '#...........#......#',
        '#..P....C...#..R...#',
        '#...........#......#',
        '#...........#..M...#',
        '#.....#######......#',
        '#.....#.....#......#',
        '#..H..#..B..#......#',
        '#.....#.....#......#',
        '#.....#######......#',
        '#.................D#',
        '####################'
      ],
      tileLegend: {
        '#': 'wall',
        '.': 'floor',
        'P': 'patient',
        'R': 'rat',
        'M': 'mosquito',
        'C': 'cart',
        'H': 'hazard',
        'B': 'boss',
        'D': 'door'
      }
    }
  };

  const MapGen = {
    build(name){
      return MAPS[name] || MAPS.tutorial;
    }
  };

  window.MapGen = MapGen;
})();
