(() => {
  'use strict';

  const VIEW_W = 960;
  const VIEW_H = 540;

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const hudCanvas = document.getElementById('hudCanvas');
  const hudCtx = hudCanvas.getContext('2d');

  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  hudCanvas.width = VIEW_W;
  hudCanvas.height = VIEW_H;

  const Entities = window.Entities || (window.Entities = {});
  const registry = new Map();
  Entities.register = function register(type, factory) {
    registry.set(type, factory);
  };
  Entities.create = function create(type, options) {
    const factory = registry.get(type);
    if (!factory) throw new Error(`Entity factory not found: ${type}`);
    return factory(options);
  };
  if (Array.isArray(Entities._pending)) {
    Entities._pending.forEach(({ type, factory }) => registry.set(type, factory));
    delete Entities._pending;
  }

  const state = {
    state: 'LOADING',
    time: 0,
    entities: [],
    events: [],
    messages: [],
    map: null,
    camera: { x: 0, y: 0, zoom: 1, w: VIEW_W, h: VIEW_H },
    input: { up: false, down: false, left: false, right: false, use: false, usePressed: false },
    player: null,
    selectedHero: 'enrique',
    healthMax: 6,
    win: false,
    tasks: { totalPatients: 0, healed: 0 }
  };

  function setupInput() {
    window.addEventListener('keydown', (ev) => {
      switch (ev.code) {
        case 'KeyW':
        case 'ArrowUp':
          state.input.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          state.input.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          state.input.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          state.input.right = true;
          break;
        case 'KeyE':
        case 'Space':
          state.input.use = true;
          state.input.usePressed = true;
          break;
        case 'KeyR':
          resetGame();
          break;
        case 'Escape':
          togglePause();
          break;
      }
    });

    window.addEventListener('keyup', (ev) => {
      switch (ev.code) {
        case 'KeyW':
        case 'ArrowUp':
          state.input.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          state.input.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          state.input.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          state.input.right = false;
          break;
        case 'KeyE':
        case 'Space':
          state.input.use = false;
          break;
      }
    });
  }

  function togglePause() {
    if (state.state === 'PLAYING') {
      state.state = 'PAUSED';
    } else if (state.state === 'PAUSED') {
      state.state = 'PLAYING';
    }
  }

  function resetGame() {
    state.entities.forEach((entity) => {
      if (entity.damageSource) {
        DamageSystem.unregisterSource(entity);
      }
      PhysicsAPI.unregisterBody(entity);
      PuppetAPI.detach?.(entity);
    });
    state.entities = [];
    state.events = [];
    state.messages = [];
    state.time = 0;
    state.win = false;
    state.player = null;
    ScoreAPI.reset?.();
    PhysicsAPI.clear?.();
    const map = MapGen.createDebugMap();
    state.map = map;
    PhysicsAPI.setMap(map);
    DamageSystem.init(state);
    ScoreAPI.init(state);
    Gameflow.init(state);
    Placement.init(state);
    Placement.spawnFromMap(map);
    SkyWeather.init?.();
    LightingAPI.setEnabled?.(true);
    state.state = 'PLAYING';
  }

  function init() {
    setupInput();
    const manifestNode = document.getElementById('sprites-manifest');
    let manifest = [];
    if (manifestNode?.textContent) {
      try {
        manifest = JSON.parse(manifestNode.textContent);
      } catch (err) {
        console.warn('Invalid sprite manifest', err);
      }
    }
    Sprites.init({ basePath: './assets/images/', tile: 32 });
    Sprites.preload(manifest);
    AudioAPI.init({ urls: { intro: './assets/audio/intro.ogg' } });
    LightingAPI.init?.({ containerId: 'game-container' });
    resetGame();
    requestAnimationFrame(loop);
  }

  function findInteractable() {
    const player = state.player;
    if (!player) return null;
    const range = 36;
    for (let i = 0; i < state.entities.length; i++) {
      const entity = state.entities[i];
      if (entity === player) continue;
      if (typeof entity.onInteract !== 'function') continue;
      const dist = Math.hypot(player.x - entity.x, player.y - entity.y);
      if (dist <= range) {
        return entity;
      }
    }
    return null;
  }

  function update(dt) {
    if (state.state !== 'PLAYING') return;
    state.time += dt;
    state.events.length = 0;

    if (state.input.usePressed) {
      const target = findInteractable();
      if (target) {
        state.player?.interact?.(target);
      }
      state.input.usePressed = false;
    }

    for (let i = 0; i < state.entities.length; i++) {
      const entity = state.entities[i];
      if (entity.remove) continue;
      entity.update?.(dt, state);
    }

    PhysicsAPI.update(dt);
    DamageSystem.update(dt);
    Gameflow.update(dt);
    LightingAPI.update?.(state);
    SkyWeather.update?.(dt);

    PuppetAPI.update(dt);

    if (state.events.length) {
      const events = state.events.slice();
      events.forEach((event) => {
        if (event.type === 'damage') {
          state.messages.push('Recibes daño (-0.5)');
        } else if (event.type === 'score') {
          state.messages.push(`${event.label}: +${event.points}`);
        } else if (event.type === 'win') {
          state.messages.push('¡Emergencia resuelta!');
        }
      });
      state.events.length = 0;
    }

    if (state.messages.length > 4) {
      state.messages.splice(0, state.messages.length - 4);
    }

    for (let i = state.entities.length - 1; i >= 0; i--) {
      const entity = state.entities[i];
      if (!entity.remove) continue;
      if (entity.damageSource) {
        DamageSystem.unregisterSource(entity);
      }
      PhysicsAPI.unregisterBody(entity);
      PuppetAPI.detach?.(entity);
      state.entities.splice(i, 1);
    }
  }

  function updateCamera() {
    const player = state.player;
    if (!player) return;
    state.camera.x = player.x;
    state.camera.y = player.y;
    state.camera.zoom = 1;
  }

  function drawMap() {
    if (!state.map) return;
    const map = state.map;
    const cam = state.camera;
    const tileSize = map.tileSize;
    const cols = map.width;
    const rows = map.height;
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const worldX = col * tileSize + tileSize * 0.5;
        const worldY = row * tileSize + tileSize * 0.5;
        const screenX = (worldX - cam.x) * cam.zoom + cam.w * 0.5;
        const screenY = (worldY - cam.y) * cam.zoom + cam.h * 0.5;
        if (screenX < -tileSize || screenX > cam.w + tileSize || screenY < -tileSize || screenY > cam.h + tileSize) {
          continue;
        }
        Sprites.draw(ctx, 'suelo.png', screenX, screenY, { scale: cam.zoom, anchorX: 0.5, anchorY: 0.5 });
        if (map.tiles[row * cols + col] === 'wall') {
          Sprites.draw(ctx, 'pared.png', screenX, screenY, { scale: cam.zoom, anchorX: 0.5, anchorY: 0.5 });
        }
      }
    }
  }

  function drawHUD() {
    hudCtx.clearRect(0, 0, VIEW_W, VIEW_H);
    const hearts = state.player ? state.player.health : state.healthMax;
    for (let i = 0; i < state.healthMax; i++) {
      const x = 16 + i * 24;
      const y = 16;
      hudCtx.fillStyle = '#2d333b';
      hudCtx.fillRect(x, y, 18, 18);
      if (hearts >= i + 1) {
        hudCtx.fillStyle = '#ff4d6d';
        hudCtx.fillRect(x + 2, y + 2, 14, 14);
      } else if (hearts >= i + 0.5) {
        hudCtx.fillStyle = '#ff4d6d';
        hudCtx.fillRect(x + 2, y + 2, 7, 14);
      }
    }

    hudCtx.fillStyle = '#e6edf3';
    hudCtx.font = '12px "Press Start 2P", monospace';
    hudCtx.fillText(`Pacientes: ${state.tasks.healed}/${state.tasks.totalPatients}`, 16, 54);
    hudCtx.fillText(`Puntos: ${ScoreAPI.total ?? 0}`, 16, 72);

    const lastMessage = state.messages.slice(-1)[0];
    if (lastMessage) {
      hudCtx.fillStyle = 'rgba(13, 17, 23, 0.7)';
      hudCtx.fillRect(16, VIEW_H - 56, VIEW_W - 32, 40);
      hudCtx.fillStyle = '#e6edf3';
      hudCtx.fillText(lastMessage, 24, VIEW_H - 28);
    }

    ArrowGuide?.draw?.(hudCtx, state.camera);

    if (state.state === 'PAUSED') {
      drawOverlay('PAUSA', 'Pulsa ESC para continuar');
    } else if (state.state === 'GAMEOVER') {
      drawOverlay('GAME OVER', 'Pulsa R para reiniciar');
    } else if (state.state === 'COMPLETE') {
      drawOverlay('¡COMPLETADO!', 'Acerca el carro de urgencias para reiniciar con R');
    }
  }

  function drawOverlay(title, subtitle) {
    hudCtx.fillStyle = 'rgba(13, 17, 23, 0.8)';
    hudCtx.fillRect(0, 0, VIEW_W, VIEW_H);
    hudCtx.fillStyle = '#e6edf3';
    hudCtx.font = '20px "Press Start 2P", monospace';
    hudCtx.fillText(title, VIEW_W / 2 - hudCtx.measureText(title).width / 2, VIEW_H / 2 - 10);
    hudCtx.font = '12px "Press Start 2P", monospace';
    hudCtx.fillText(subtitle, VIEW_W / 2 - hudCtx.measureText(subtitle).width / 2, VIEW_H / 2 + 16);
  }

  function draw() {
    updateCamera();
    drawMap();
    ctx.save();
    ctx.fillStyle = SkyWeather.getAmbientTint?.() || 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
    PuppetAPI.draw(ctx, state.camera);
    drawHUD();
  }

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.12);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  window.Game = { reset: resetGame };
  init();
})();
