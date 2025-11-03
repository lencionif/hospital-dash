// filename: test.plugin.js
// Autotest + QA overlay para Il Divo: Hospital Dash!
(function (W) {
  'use strict';

  const params = new URLSearchParams(location.search || '');
  const AUTO_TEST = params.get('autotest') === '1';
  const QA_LOOP_PARAM = params.get('qaLoop');
  if (QA_LOOP_PARAM === '1') {
    try { localStorage.setItem('qaLoop', 'true'); } catch (_) {}
  } else if (QA_LOOP_PARAM === '0') {
    try { localStorage.removeItem('qaLoop'); } catch (_) {}
  }
  const QA_LOOP = QA_LOOP_PARAM === '1' || (function () {
    try { return localStorage.getItem('qaLoop') === 'true'; }
    catch (_) { return false; }
  })();

  const state = {
    overlay: null,
    statusNode: null,
    placementsNode: null,
    rigsNode: null,
    cameraNode: null,
    minimapNode: null,
    countsNode: null,
    retryButton: null,
    awaitingRetry: false,
    results: null,
  };

  function ensureOverlay() {
    if (state.overlay) return state.overlay;
    const styleId = 'qa-autotest-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .qa-autotest-overlay{position:fixed;top:16px;right:16px;max-width:360px;z-index:45000;background:rgba(8,12,18,0.92);color:#f4f7fb;font:12px/1.5 'Fira Code',monospace;border:1px solid rgba(88,166,255,0.45);border-radius:12px;box-shadow:0 20px 48px rgba(0,0,0,0.45);padding:16px;backdrop-filter:blur(4px);}
        .qa-autotest-overlay.qa-pass{border-color:#2ea043;}
        .qa-autotest-overlay.qa-fail{border-color:#f85149;}
        .qa-autotest-title{margin:0 0 8px;font-size:15px;font-weight:600;display:flex;justify-content:space-between;align-items:center;}
        .qa-autotest-status{font-size:14px;font-weight:700;margin-bottom:10px;}
        .qa-autotest-status.pass{color:#3fb950;}
        .qa-autotest-status.fail{color:#ff7b72;}
        .qa-autotest-section{margin-bottom:10px;}
        .qa-autotest-section strong{display:block;color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px;}
        .qa-autotest-detail{margin:0;color:#f4f7fb;font-size:12px;white-space:pre-wrap;}
        .qa-autotest-counts{margin-top:8px;font-size:11px;color:#a6b1c2;}
        .qa-autotest-counts span{display:inline-block;margin-right:6px;margin-bottom:2px;padding:2px 6px;border-radius:8px;background:rgba(88,166,255,0.12);}
        .qa-autotest-retry{margin-top:12px;width:100%;padding:8px 10px;font:12px 'Fira Code',monospace;border-radius:8px;border:1px solid #ff7b72;background:rgba(255,123,114,0.1);color:#ff938a;cursor:pointer;}
        .qa-autotest-retry:hover{background:rgba(255,123,114,0.18);}
        .qa-autotest-retry.shake{animation:qa-shake 0.42s ease;}
        @keyframes qa-shake{0%,100%{transform:translateX(0);}25%{transform:translateX(-4px);}75%{transform:translateX(4px);}}
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('section');
    overlay.className = 'qa-autotest-overlay qa-pass';

    const title = document.createElement('div');
    title.className = 'qa-autotest-title';
    title.textContent = 'QA autotest';

    const statusNode = document.createElement('div');
    statusNode.className = 'qa-autotest-status pass';
    statusNode.textContent = 'PASS';

    const placementsNode = document.createElement('div');
    placementsNode.className = 'qa-autotest-section';
    placementsNode.innerHTML = '<strong>Placements</strong><p class="qa-autotest-detail">Pendiente…</p>';

    const rigsNode = document.createElement('div');
    rigsNode.className = 'qa-autotest-section';
    rigsNode.innerHTML = '<strong>Rigs</strong><p class="qa-autotest-detail">Pendiente…</p>';

    const cameraNode = document.createElement('div');
    cameraNode.className = 'qa-autotest-section';
    cameraNode.innerHTML = '<strong>Cámara</strong><p class="qa-autotest-detail">Pendiente…</p>';

    const minimapNode = document.createElement('div');
    minimapNode.className = 'qa-autotest-section';
    minimapNode.innerHTML = '<strong>Minimapa</strong><p class="qa-autotest-detail">Pendiente…</p>';

    const countsNode = document.createElement('div');
    countsNode.className = 'qa-autotest-counts';

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'qa-autotest-retry';
    retryButton.textContent = 'Reintentar (R)';
    retryButton.style.display = 'none';
    retryButton.addEventListener('click', () => {
      if (!QA_LOOP) return;
      triggerRetry();
    });

    overlay.appendChild(title);
    overlay.appendChild(statusNode);
    overlay.appendChild(placementsNode);
    overlay.appendChild(rigsNode);
    overlay.appendChild(cameraNode);
    overlay.appendChild(minimapNode);
    overlay.appendChild(countsNode);
    overlay.appendChild(retryButton);
    document.body.appendChild(overlay);

    state.overlay = overlay;
    state.statusNode = statusNode;
    state.placementsNode = placementsNode.querySelector('.qa-autotest-detail');
    state.rigsNode = rigsNode.querySelector('.qa-autotest-detail');
    state.cameraNode = cameraNode.querySelector('.qa-autotest-detail');
    state.minimapNode = minimapNode.querySelector('.qa-autotest-detail');
    state.countsNode = countsNode;
    state.retryButton = retryButton;

    return overlay;
  }

  function getGame() {
    return W.G || (W.G = {});
  }

  function collectEntities() {
    const G = getGame();
    const out = [];
    const seen = new Set();
    const push = (e) => {
      if (!e || seen.has(e) || e.dead) return;
      seen.add(e);
      out.push(e);
    };
    const entities = Array.isArray(G.entities) ? G.entities : [];
    for (const ent of entities) push(ent);
    push(G.player);
    push(G.door);
    push(G.cart);
    push(G.boss);
    if (Array.isArray(G.elevators)) {
      for (const elev of G.elevators) push(elev);
    }
    return out;
  }

  function matchesKind(ent, key) {
    if (!ent || !key) return false;
    const target = String(key).toUpperCase();
    const ENT = W.ENT || {};
    if (typeof ent.kind === 'number' && ENT[target] != null && ENT[target] === ent.kind) return true;
    const fields = [ent.kindName, ent.kind, ent.type, ent.role, ent.tag];
    return fields.some((value) => typeof value === 'string' && value.toUpperCase() === target);
  }

  function classifyEntityForTest(ent) {
    if (!ent) return 'OTHER';
    const G = getGame();
    const rig = (ent.rigName || ent.puppet?.rigName || '').toString().toLowerCase();
    if (ent === G.player || matchesKind(ent, 'PLAYER') || rig.startsWith('hero_')) return 'HERO';
    if (matchesKind(ent, 'BOSS') || ent.isBoss === true || rig.startsWith('boss')) return 'BOSS';
    if (matchesKind(ent, 'DOOR') || ent.bossDoor || rig === 'door') return 'DOOR_URGENCIAS';
    if (matchesKind(ent, 'CART') || ent.cartType || rig.startsWith('cart_')) return 'CART';
    if (matchesKind(ent, 'ELEVATOR') || rig.includes('elevator')) return 'ELEVATOR';
    if (matchesKind(ent, 'PATIENT') || ent.isPatient || rig.includes('patient')) return 'PATIENT';
    if (rig === 'npc_medico' || matchesKind(ent, 'MEDIC')) return 'NPC_MEDICO';
    if (rig === 'npc_jefe_servicio' || rig === 'npc_supervisora' || matchesKind(ent, 'CHIEF') || matchesKind(ent, 'SUPERVISORA')) return 'NPC_JEFE';
    if (matchesKind(ent, 'RAT') || rig === 'rat') return 'ENEMY_RAT';
    if (matchesKind(ent, 'MOSQUITO') || rig === 'mosquito') return 'ENEMY_MOSQUITO';
    return 'OTHER';
  }

  function collectAsciiCounts() {
    const G = getGame();
    const raw = Array.isArray(G.__asciiPlacements) ? G.__asciiPlacements : [];
    const counts = {};
    for (const item of raw) {
      if (!item) continue;
      let key = null;
      if (typeof W.classifyKind === 'function') {
        key = W.classifyKind(item.type || item.kind || item.k, item);
      } else {
        key = String(item.type || item.kind || item.k || '').toUpperCase();
      }
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    const mapped = {};
    mapped.HERO = counts.HERO || 0;
    mapped.BOSS = counts.BOSS || 0;
    mapped.CART = counts.CART || 0;
    mapped.DOOR_URGENCIAS = (counts.DOOR || 0);
    mapped.ELEVATOR = counts.ELEVATOR || 0;
    mapped.PATIENT = counts.PATIENT || 0;
    mapped.NPC_MEDICO = counts.NPC_MEDICO || 0;
    mapped.NPC_JEFE = counts.NPC_CHIEF || 0;
    mapped.ENEMY_RAT = counts.RAT || 0;
    mapped.ENEMY_MOSQUITO = counts.MOSQUITO || 0;
    return mapped;
  }

  function checkPlacements() {
    const requiredKeys = ['HERO','DOOR_URGENCIAS','BOSS','CART','ELEVATOR','PATIENT','NPC_MEDICO','NPC_JEFE','ENEMY_RAT','ENEMY_MOSQUITO'];
    const counts = Object.fromEntries(requiredKeys.map((k) => [k, 0]));
    const asciiCounts = collectAsciiCounts();
    const entities = collectEntities();
    for (const ent of entities) {
      const key = classifyEntityForTest(ent);
      if (counts[key] != null) {
        counts[key] += 1;
      }
    }
    // Ajusta elevadores si no hay en ASCII
    const missing = [];
    const duplicates = [];
    for (const key of requiredKeys) {
      const ascii = asciiCounts[key] || 0;
      const actual = counts[key] || 0;
      const requiredMin = (key === 'ELEVATOR' && ascii === 0) ? 0 : 1;
      if (actual < requiredMin) {
        missing.push(`${key} (tiene ${actual})`);
      }
      if (ascii === 1 && actual !== 1) {
        duplicates.push(`${key} esperado=1 actual=${actual}`);
      }
      if (ascii > 1 && actual < ascii) {
        missing.push(`${key} ascii=${ascii} actual=${actual}`);
      }
    }
    const pass = missing.length === 0 && duplicates.length === 0;
    return { pass, missing, duplicates, counts, ascii: asciiCounts };
  }

  function checkRigs() {
    const entities = collectEntities();
    const failing = [];
    for (const ent of entities) {
      const rigName = (ent.rigName || ent.puppet?.rigName || '').toString();
      if (ent.rigOk !== true || !rigName.trim()) {
        failing.push({
          id: ent.id || ent.name || null,
          kind: ent.kindName || ent.kind || ent.type || 'UNKNOWN',
          rigOk: ent.rigOk === true,
          rigName: rigName || null,
        });
      }
    }
    return { pass: failing.length === 0, failing, total: entities.length };
  }

  function checkCamera() {
    const cam = W.camera || getGame().camera || null;
    const zoom = cam?.zoom;
    const pass = Number.isFinite(zoom) && zoom > 0;
    return { pass, zoom };
  }

  function checkMinimap() {
    const toggle = typeof W.__toggleMinimapMode === 'function' ? W.__toggleMinimapMode : null;
    if (!toggle) {
      return { pass: false, reason: 'toggle-missing' };
    }
    try {
      const first = toggle();
      const second = toggle();
      const initial = first === 'big' ? 'small' : 'big';
      const restored = second === initial;
      const changed = first && second && first !== second;
      return { pass: !!(changed && restored), before: initial, after: first, final: second };
    } catch (err) {
      return { pass: false, reason: err?.message || 'toggle-error' };
    }
  }

  function isReady() {
    const G = getGame();
    return !!(Array.isArray(G.entities) && G.entities.length && G.player);
  }

  function runSelfTestInternal() {
    const placements = checkPlacements();
    const rigs = checkRigs();
    const camera = checkCamera();
    const minimap = checkMinimap();
    const pass = placements.pass && rigs.pass && camera.pass && minimap.pass;
    const result = {
      pass,
      placements,
      rigs,
      camera,
      minimap,
      timestamp: new Date().toISOString(),
    };
    state.results = result;
    return result;
  }

  function formatCounts(counts) {
    if (!counts) return '';
    const entries = Object.entries(counts).filter(([_, value]) => value != null);
    if (!entries.length) return '';
    return entries.map(([key, value]) => `<span>${key}: ${value}</span>`).join('');
  }

  function renderOverlay(results) {
    const overlay = ensureOverlay();
    const pass = !!results?.pass;
    overlay.classList.toggle('qa-pass', pass);
    overlay.classList.toggle('qa-fail', !pass);
    if (state.statusNode) {
      state.statusNode.textContent = pass ? 'PASS' : 'FAIL';
      state.statusNode.className = `qa-autotest-status ${pass ? 'pass' : 'fail'}`;
    }
    if (state.placementsNode) {
      if (results?.placements) {
        const p = results.placements;
        if (p.pass) {
          state.placementsNode.textContent = 'OK';
        } else {
          const bits = [];
          if (p.missing.length) bits.push(`Faltan: ${p.missing.join(', ')}`);
          if (p.duplicates.length) bits.push(`Duplicados: ${p.duplicates.join(', ')}`);
          state.placementsNode.textContent = bits.join(' · ') || 'Falló';
        }
      } else {
        state.placementsNode.textContent = 'Sin datos';
      }
    }
    if (state.rigsNode) {
      if (results?.rigs) {
        const r = results.rigs;
        if (r.pass) {
          state.rigsNode.textContent = `OK (${r.total} entidades)`;
        } else {
          const sample = r.failing.slice(0, 4).map((f) => `${f.kind || 'Entidad'} (${f.rigName || 'sin rig'})`);
          const more = r.failing.length > sample.length ? ` +${r.failing.length - sample.length} más` : '';
          state.rigsNode.textContent = `Fallan ${r.failing.length}/${r.total}: ${sample.join(', ')}${more}`;
        }
      } else {
        state.rigsNode.textContent = 'Sin datos';
      }
    }
    if (state.cameraNode) {
      if (results?.camera) {
        const c = results.camera;
        state.cameraNode.textContent = c.pass ? `zoom=${Number(c.zoom ?? 0).toFixed(2)}` : `zoom inválido (${c.zoom})`;
      } else {
        state.cameraNode.textContent = 'Sin datos';
      }
    }
    if (state.minimapNode) {
      if (results?.minimap) {
        const m = results.minimap;
        if (m.pass) {
          state.minimapNode.textContent = `ciclo ${m.before || 'small'} → ${m.after || '?'} → ${m.final || '?'}`;
        } else {
          state.minimapNode.textContent = `Error: ${m.reason || 'toggle'}`;
        }
      } else {
        state.minimapNode.textContent = 'Sin datos';
      }
    }
    if (state.countsNode) {
      state.countsNode.innerHTML = formatCounts(results?.placements?.counts);
    }
    if (state.retryButton) {
      state.retryButton.style.display = (!pass && QA_LOOP) ? 'block' : 'none';
    }
  }

  function selfTest(options = {}) {
    if (!isReady()) {
      const fallback = {
        pass: false,
        reason: 'not-ready',
        placements: { pass: false, missing: ['Juego no inicializado'], duplicates: [], counts: null, ascii: null },
        rigs: { pass: false, failing: [], total: 0 },
        camera: { pass: false, zoom: null },
        minimap: { pass: false, reason: 'not-ready' },
        timestamp: new Date().toISOString(),
      };
      if (options.display !== false) {
        state.results = fallback;
        renderOverlay(fallback);
      }
      return fallback;
    }
    const result = runSelfTestInternal();
    if (options.display !== false) {
      renderOverlay(result);
    }
    try { console.info('[QA] selfTest resultado', result); } catch (_) {}
    return result;
  }

  function rigTest(options = {}) {
    const rigs = checkRigs();
    const result = {
      pass: rigs.pass,
      placements: state.results?.placements || null,
      rigs,
      camera: state.results?.camera || checkCamera(),
      minimap: state.results?.minimap || checkMinimap(),
      timestamp: new Date().toISOString(),
    };
    state.results = result;
    if (options.display !== false) {
      renderOverlay(result);
    }
    try { console.info('[QA] rigTest resultado', result); } catch (_) {}
    return result;
  }

  function waitForReady(maxAttempts = 40, delayMs = 150) {
    return new Promise((resolve) => {
      let attempt = 0;
      const tick = () => {
        if (isReady()) {
          resolve(true);
          return;
        }
        attempt += 1;
        if (attempt >= maxAttempts) {
          resolve(false);
          return;
        }
        setTimeout(tick, delayMs);
      };
      tick();
    });
  }

  async function runAutoTest(reason) {
    const ready = await waitForReady();
    const results = selfTest();
    if (!ready && !results.pass) {
      console.warn('[QA] selfTest ejecutado sin estado listo (razón:', reason, ')');
    }
    if (!results.pass && QA_LOOP) {
      state.retryButton?.classList.add('shake');
      setTimeout(() => state.retryButton?.classList.remove('shake'), 420);
    }
    return results;
  }

  function triggerRetry() {
    if (!QA_LOOP) return;
    state.awaitingRetry = true;
    const G = getGame();
    const level = G.level || 1;
    try {
      W.startGame?.(level);
    } catch (err) {
      console.warn('[QA] startGame retry falló', err);
    }
  }

  document.addEventListener('keydown', (ev) => {
    if (!QA_LOOP || !state.overlay || state.overlay.classList.contains('qa-pass')) return;
    if (ev.key && (ev.key.toLowerCase() === 'r')) {
      ev.preventDefault();
      triggerRetry();
    }
  }, { capture: true });

  W.selfTest = selfTest;
  W.rigTest = rigTest;

  W.addEventListener('game:start', () => {
    if (AUTO_TEST || state.awaitingRetry || QA_LOOP) {
      state.awaitingRetry = false;
      runAutoTest('game:start');
    }
  });

  if (AUTO_TEST) {
    waitForReady().then(() => runAutoTest('autotest-param'));
  }
})(window);
