// === game.js ===
(function(){
  const TILE = 32;
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const fogCanvas = document.getElementById('fog-canvas');
  const hudEl = document.getElementById('hud');
  const debugEl = document.getElementById('debug-log');
  const overlay = document.getElementById('hero-select');

  const Keys = new Set();
  window.addEventListener('keydown', (ev)=>{
    Keys.add(ev.code);
    if (ev.code === 'Digit3') SkyWeather.cycleMode();
    if (ev.code === 'Digit4') LightingAPI.toggleFlashlight();
  });
  window.addEventListener('keyup', (ev)=> Keys.delete(ev.code));

  window.SPAWN_DEBUG = {
    RAT: true,
    MOSQUITO: true,
    PATIENT: true,
    CART: true,
    DOOR: true,
    ELEVATOR: true,
    HAZARD: true,
    BOSS: true
  };

  const G = {
    entities: [],
    enemies: [],
    patients: [],
    doors: [],
    map: [],
    mapW: 0,
    mapH: 0,
    camera: { x:0, y:0, zoom:1 },
    player: null,
    heroKey: null,
    state: 'MENU',
    time: 0,
    weather: 'day',
    target: null,
    hearts: 6,
    world:{ tileSize:TILE }
  };
  window.G = G;

  Sprites.init({ basePath:'assets/images/' });
  GameFlow.init();
  ScoreAPI.init();
  SkyWeather.init(canvas);
  LightingAPI.init({ canvas, fogCanvas });
  ArrowGuide.init(canvas);
  PhysicsAPI.init({ tileSize: TILE, solidTiles: isWall });

  const mapData = MapGen.build('tutorial');
  buildWorld(mapData);
  registerHeroButtons();

  let last = performance.now();
  function loop(now){
    const dt = Math.min(0.1, (now - last)/1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function registerHeroButtons(){
    overlay.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => startGame(btn.dataset.hero));
    });
  }

  function startGame(heroKey){
    overlay.classList.add('hidden');
    G.state = 'PLAYING';
    GameFlow.startRun(G.patients.length);
    G.heroKey = heroKey;
    if (heroKey === 'enrique') G.player = HeroesFactory.makeEnrique();
    else if (heroKey === 'roberto') G.player = HeroesFactory.makeRoberto();
    else G.player = HeroesFactory.makeFrancesco();
    G.player.x = TILE*2.5;
    G.player.y = TILE*5.5;
    G.player.health = G.hearts;
    G.entities.push(G.player);
    updateArrowTarget();
  }

  function buildWorld(map){
    G.map = map.tiles.map(row => [...row]);
    G.mapH = G.map.length;
    G.mapW = G.map[0].length;
    PlacementAPI.fromMap(map, place => {
      const { tag, x, y } = place;
      if (tag === 'patient' && SPAWN_DEBUG.PATIENT){
        const p = PatientsFactory.makePatient(x, y, ['pill', 'iv']);
        G.entities.push(p); G.patients.push(p);
      }
      if (tag === 'rat' && SPAWN_DEBUG.RAT){
        const r = RatFactory.makeRat(x, y);
        G.entities.push(r); G.enemies.push(r);
      }
      if (tag === 'mosquito' && SPAWN_DEBUG.MOSQUITO){
        const m = MosquitoFactory.makeMosquito(x, y);
        G.entities.push(m); G.enemies.push(m);
      }
      if (tag === 'cart' && SPAWN_DEBUG.CART){
        const c = CartsFactory.makeCart(x, y);
        G.entities.push(c);
      }
      if (tag === 'hazard' && SPAWN_DEBUG.HAZARD){
        const h = HazardFactory.makeFire(x, y);
        G.entities.push(h); G.enemies.push(h);
      }
      if (tag === 'door' && SPAWN_DEBUG.DOOR){
        const d = DoorFactory.makeDoor(x, y);
        d.locked = true;
        G.entities.push(d); G.doors.push(d);
      }
      if (tag === 'boss' && SPAWN_DEBUG.BOSS){
        const b = { id:'bossDoor', kind:'boss', x, y, w:36, h:42, solid:true, puppet:{rig:'biped',z:4,skin:'boss.png'} };
        PuppetAPI.attach(b, b.puppet);
        G.entities.push(b);
        G.bossDoor = b;
      }
      return true;
    });
  }

  function update(dt){
    SkyWeather.update(dt);
    if (G.state !== 'PLAYING' || !G.player) return;
    G.time += dt;
    handleInput(dt);

    for (const e of G.entities){
      if (e && e.aiUpdate) e.aiUpdate(dt, e, G);
    }

    PhysicsAPI.update(dt, G.entities, G.world);

    updateSystems(dt);

    DamageAPI.update(dt, G.player);
    DamageAPI.tickAttackers(dt, G.enemies);
    for (const enemy of G.enemies){
      if (enemy.dead) continue;
      if (aabbOverlap(G.player, enemy)){
        DamageAPI.applyTouch(enemy, G.player);
      }
    }

    PuppetAPI.update(dt);
    updateCamera();
    updateArrowTarget();
    updateHud();
  }

  function updateSystems(dt){
    for (const door of G.doors){
      if (door.locked && GameFlow.curedPatients >= GameFlow.targetPatients){
        door.locked = false;
        door.solid = false;
      }
    }
    if (G.player && G.player.health <= 0){
      GameFlow.setState('GAMEOVER');
      G.state = 'GAMEOVER';
      debug('¡Has colapsado!');
    }
  }

  function updateCamera(){
    if (!G.player) return;
    G.camera.x = G.player.x;
    G.camera.y = G.player.y;
    G.camera.zoom = 1;
  }

  function updateArrowTarget(){
    let target = null;
    if (GameFlow.curedPatients < GameFlow.targetPatients){
      target = G.patients.find(p => !p.satisfied) || null;
    } else if (G.bossDoor){
      target = G.bossDoor;
    }
    G.target = target;
    ArrowGuide.setTarget(target);
  }

  function updateHud(){
    if (!hudEl) return;
    hudEl.innerHTML = `
      <span>Salud: ${(G.player?.health ?? G.hearts).toFixed(1)}</span>
      <span>Entregas: ${ScoreAPI.deliveries}</span>
      <span>Objetivo: ${GameFlow.curedPatients}/${GameFlow.targetPatients}</span>
      <span>Clima: ${SkyWeather.mode}</span>
    `;
  }

  function handleInput(dt){
    const p = G.player;
    if (!p) return;
    const ax = (Keys.has('ArrowRight')||Keys.has('KeyD')?1:0) - (Keys.has('ArrowLeft')||Keys.has('KeyA')?1:0);
    const ay = (Keys.has('ArrowDown')||Keys.has('KeyS')?1:0) - (Keys.has('ArrowUp')||Keys.has('KeyW')?1:0);
    const mag = Math.hypot(ax, ay) || 1;
    p.vx = (ax/mag) * p.speed;
    p.vy = (ay/mag) * p.speed;
    if (ax || ay){
      p.dir = Math.atan2(p.vy, p.vx);
    }
    if (Keys.has('Space')){
      interact();
    }
  }

  function interact(){
    const p = G.player;
    if (!p) return;
    for (const patient of G.patients){
      if (patient.satisfied) continue;
      if (distance(p, patient) < TILE){
        patient.satisfied = true;
        ScoreAPI.recordDelivery();
        GameFlow.markPatientHealed();
        debug('Paciente atendido.');
        break;
      }
    }
  }

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawWorld();
    PuppetAPI.draw(ctx, G.camera);
    ArrowGuide.draw(G.camera, G.player);
    LightingAPI.drawFog(G.camera, G.player);
  }

  function drawWorld(){
    for (let y=0; y<G.mapH; y++){
      for (let x=0; x<G.mapW; x++){
        const tile = G.map[y][x];
        const wx = x*TILE;
        const wy = y*TILE;
        ctx.fillStyle = tile === '#' ? '#2d3138' : '#1a1d23';
        const sx = (wx - G.camera.x + canvas.width*0.5);
        const sy = (wy - G.camera.y + canvas.height*0.5);
        ctx.fillRect(sx, sy, TILE, TILE);
      }
    }
  }

  function isWall(tx, ty){
    if (ty < 0 || ty >= G.mapH || tx < 0 || tx >= G.mapW) return true;
    return G.map[ty][tx] === '#';
  }

  function aabbOverlap(a,b){
    return Math.abs(a.x-b.x) < (a.w+b.w)*0.5 && Math.abs(a.y-b.y) < (a.h+b.h)*0.5;
  }

  function distance(a,b){
    return Math.hypot(a.x-b.x, a.y-b.y);
  }

  function debug(msg){
    if (!debugEl) return;
    const line = document.createElement('div');
    line.textContent = `[${(G.time).toFixed(1)}] ${msg}`;
    debugEl.appendChild(line);
    debugEl.scrollTop = debugEl.scrollHeight;
  }
})();
