// === placement.api.js ===
(function(){
  const TILE = 32;

  const PlacementAPI = {
    fromMap(map, factory){
      const tiles = map.tiles;
      const legend = map.tileLegend || {};
      const placements = [];
      tiles.forEach((row, y)=>{
        [...row].forEach((ch, x)=>{
          const tag = legend[ch];
          const worldX = x*TILE + TILE*0.5;
          const worldY = y*TILE + TILE*0.5;
          placements.push({ tag, x:worldX, y:worldY, tileX:x, tileY:y, char:ch });
        });
      });
      return placements.filter(p => p.tag && factory(p));
    }
  };

  window.PlacementAPI = PlacementAPI;
})();
