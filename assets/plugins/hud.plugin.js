(() => {
  'use strict';

  // === Config/tema por defecto ===
  const THEME = {
    bg:    'rgba(0,0,0,0.65)',
    text:  '#ffffff',
    ok:    '#19c37d',
    warn:  '#ffd166',
    accent:'#19c37d',
    stroke:'#ff5a6b',
  };

  const S = {
    position: (('ontouchstart' in window) ? 'bottom' : 'top'), // móvil: abajo; PC: arriba
    height: 104,
    pad: 16,
    font: '15px "IBM Plex Mono", monospace',
  };

  // Helpers
  const W = window;
  const getG = () => (W.G || {});
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const FloatingMessages = [];

  function findEntityById(G, id) {
    if (!id) return null;
    if (typeof G?.byId === 'function') {
      try { const e = G.byId(id); if (e) return e; } catch (_) {}
    }
    return (G?.entities || []).find(e => e && e.id === id) || null;
  }

  function toScreen(camera, canvas, worldX, worldY) {
    if (typeof window.toScreen === 'function') {
      try {
        const res = window.toScreen(camera, canvas, worldX, worldY);
        if (res && typeof res.x === 'number' && typeof res.y === 'number') return res;
      } catch (_) {}
    }
    const cam = camera || { x: 0, y: 0, zoom: 1 };
    const zoom = cam.zoom || 1;
    const cx = canvas ? canvas.width * 0.5 : 0;
    const cy = canvas ? canvas.height * 0.5 : 0;
    return {
      x: (worldX - cam.x) * zoom + cx,
      y: (worldY - cam.y) * zoom + cy
    };
  }

  // —— Lógica de “objetivo” (trasladada del motor) ——
  // Mantiene exactamente los casos especiales, carga de pastilla, apertura de puerta, etc.
  // Basado en drawHUD() actual del juego. 2
  function computeObjective(G) {
    // 1) Flags especiales (incendio/psiquiátrica)
    if (G.fireActive === true && G.psySaved !== true) {
      return 'Objetivo: salva a la paciente psiquiátrica del incendio';
    }
    if (G.fireActive === true && G.psySaved === true) {
      return 'Objetivo: vuelve al control para salir antes de que se queme todo';
    }

    // 2) Si llevas una pastilla → entregarla a su paciente
    const carry = G.player?.carry || G.carry;
    if (carry && (carry.label || carry.patientName)) {
      const pill = carry.label || 'la pastilla';
      const who  = carry.patientName || 'el paciente asignado';
      return `Objetivo: entrega ${pill} a ${who}`;
    }

    // 3) Si no llevas → buscar una para un paciente (usa vínculos si existen)
    const hayPacientes = Array.isArray(G.patients) && G.patients.length > 0;
    const hayPills     = Array.isArray(G.pills)     && G.pills.length     > 0;
    if (!carry && hayPacientes) {
      if (hayPills) {
        const linked = G.pills.find(p => p.targetName || p.label) || G.pills[0];
        const pill = linked?.label || 'la pastilla';
        const who  = linked?.targetName || (G.patients[0]?.name || 'el paciente');
        return `Objetivo: busca ${pill} para ${who}`;
      }
      const who = G.patients[0]?.name || 'el paciente';
      return `Objetivo: busca la pastilla para ${who}`;
    }

    // 4) Si ya no quedan pacientes → carro + boss (puerta)
    const sinPacientes = Array.isArray(G.patients) && G.patients.length === 0;
    if (sinPacientes) {
      const puertaAbierta = !!(G.door && (G.door.open === true || G.door.solid === false));
      if (puertaAbierta && G.cart && G.boss) return 'Objetivo: acerca el carro de urgencias al paciente final';
      return 'Objetivo: abre la puerta y lleva el carro al final';
    }

    // 5) Fallback
    return 'Objetivo: ninguno';
  }

  // —— Corazones 2.0: latido “lub-dub”, squash & stretch y halo ——
  function drawHearts(ctx, x, y, halves, maxHearts, scaleX = 1, scaleY = 1, glow = 0) {
    const STEP = 22;
    const N = (maxHearts != null)
      ? maxHearts
      : Math.max(1, ((window.G?.healthMax | 0) ? (window.G.healthMax | 0) / 2
                                              : (window.G?.player?.hpMax || 3)));

    for (let i = 0; i < N; i++) {
      const v = halves - i * 2;
      const state = v >= 2 ? 2 : (v === 1 ? 1 : 0);
      drawHeart(ctx, x + i * STEP, y, state, scaleX, scaleY, glow);
    }
  }

  function drawHeart(ctx, x, y, state, scaleX = 1, scaleY = 1, glow = 0) {
    ctx.save();

    // Centro aproximado del corazón para escalar alrededor
    const ax = 10, ay = 18;
    ctx.translate(x + ax * (1 - scaleX), y + ay * (1 - scaleY));
    ctx.scale(scaleX, scaleY);

    // Halo/brillo + grosor de trazo aumentan con el pulso
    const glowPx = 10 + 40 * glow;             // 10..50 px
    ctx.shadowColor = 'rgba(255,107,107,0.85)';
    ctx.shadowBlur  = glowPx;
    ctx.lineWidth   = 2 + 2.2 * glow;          // 2..4.2 px
    ctx.strokeStyle = THEME.stroke;

    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(10, 18);
      ctx.bezierCurveTo(10, 10, 0, 10, 0, 18);
      ctx.bezierCurveTo(0, 26, 10, 28, 10, 34);
      ctx.bezierCurveTo(10, 28, 20, 26, 20, 18);
      ctx.bezierCurveTo(20, 10, 10, 10, 10, 18);
      ctx.closePath();
    };

    // Relleno según estado
    if (state === 2) {
      outline(); ctx.fillStyle = '#ff6b6b'; ctx.fill(); ctx.stroke(); ctx.restore(); return;
    }
    if (state === 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, -6, 10, 40); // clip mitad izda
      ctx.clip(); outline(); ctx.fillStyle = '#ff6b6b'; ctx.fill(); ctx.restore();
      outline(); ctx.stroke(); ctx.restore(); return;
    }

    outline(); ctx.stroke(); ctx.restore();
  }


  // Ellipsis si el texto no cabe
  function ellipsize(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 4 && ctx.measureText(out + '…').width > maxWidth) {
      out = out.slice(0, -1);
    }
    return out + '…';
  }

  // Envuelve por palabras hasta 'maxLines' líneas (la última absorbe el resto)
  function wrapText(ctx, text, maxWidth, maxLines = 2) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';

    for (let i = 0; i < words.length; i++) {
      const test = line ? (line + ' ' + words[i]) : words[i];
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        lines.push(line || words[i]);
        line = words[i];
        if (lines.length === maxLines - 1) {
          // Última línea: mete todo lo que queda y salimos
          line = words.slice(i + 1).length ? (line + ' ' + words.slice(i + 1).join(' ')) : line;
          break;
        }
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Reduce el tamaño de fuente (px) hasta que quepa en 1–2 líneas
  function fitAndWrap(ctx, basePx, text, maxWidth, maxLines = 2, minPx = 11) {
    let px = basePx, lines = [];
    while (px >= minPx) {
      ctx.font = `${px}px monospace`;
      lines = wrapText(ctx, text, maxWidth, maxLines);
      if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxWidth)) break;
      px--;
    }
    return { px, lines };
  }

  function drawNameTags(ctx, camera, G) {
    if (!ctx || !G) return;
    const canvas = ctx.canvas;
    for (const pat of G.patients || []) {
      if (!pat || pat.dead || pat.attended) continue;
      const pos = toScreen(camera, canvas, pat.x + pat.w * 0.5, pat.y - (pat.nameTagYOffset || 18));
      ctx.save();
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(pat.displayName || pat.name || 'Paciente', pos.x, pos.y);
      ctx.fillStyle = '#ffe27a';
      ctx.fillText(pat.displayName || pat.name || 'Paciente', pos.x, pos.y);
      ctx.restore();
    }
  }

  function drawFloatingMessages(ctx, camera, G) {
    if (!ctx) return;
    const now = performance.now();
    const canvas = ctx.canvas;
    for (let i = FloatingMessages.length - 1; i >= 0; i--) {
      const msg = FloatingMessages[i];
      const life = (now - msg.created) / 1000;
      if (life >= msg.dur) {
        FloatingMessages.splice(i, 1);
        continue;
      }
      const ent = findEntityById(G, msg.targetId) || msg.fallback;
      if (!ent) { FloatingMessages.splice(i, 1); continue; }
      const baseX = (ent.x || 0) + (ent.w || 0) * 0.5;
      const baseY = (ent.y || 0) - (msg.offset || ent.nameTagYOffset || 18);
      const rise = (msg.rise || 18) * (life / msg.dur);
      const pos = toScreen(camera, canvas, baseX, baseY - rise);
      const alpha = Math.max(0, 1 - (life / msg.dur));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(msg.text, pos.x, pos.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(msg.text, pos.x, pos.y);
      ctx.restore();
    }
  }

  function showFloatingMessage(entity, text, seconds = 1.8) {
    if (!entity || !text) return;
    FloatingMessages.push({
      targetId: entity.id || null,
      fallback: entity,
      text: String(text),
      created: performance.now(),
      dur: Math.max(0.2, seconds),
      offset: entity.nameTagYOffset || 18,
      rise: 28
    });
  }

  function drawPatientsCounterPanel(ctx, G) {
    const snap = window.patientsSnapshot ? window.patientsSnapshot() : {
      total: G?.stats?.totalPatients || 0,
      pending: G?.stats?.remainingPatients || 0,
      cured: G?.stats?.furiosasNeutralized || 0,
      furious: G?.stats?.activeFuriosas || 0,
    };
    const remaining = snap.pending || 0;
    const cured = snap.cured || 0;
    const total = snap.total || 0;
    const furiosas = snap.furious || 0;
    const urgOpen = (G?.urgenciasOpen === true) || (remaining === 0 && furiosas === 0);
    const r = { x: 12, y: 12, w: 260, h: 96 };
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = urgOpen ? '#2ecc71' : '#e67e22';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#e6edf3';
    ctx.textAlign = 'left';
    ctx.fillText(`Pacientes: ${cured} / ${total}`, r.x + 12, r.y + 24);
    ctx.fillStyle = '#9aa6b1';
    ctx.fillText(`Pendientes: ${remaining}`, r.x + 12, r.y + 42);
    ctx.fillStyle = furiosas > 0 ? '#ff6b6b' : '#9aa6b1';
    ctx.fillText(`Furiosas activas: ${furiosas}`, r.x + 12, r.y + 60);
    ctx.fillStyle = urgOpen ? '#ffd166' : '#9aa6b1';
    ctx.fillText(`Urgencias: ${urgOpen ? 'ABIERTO' : 'CERRADO'}`, r.x + 12, r.y + 78);
    ctx.restore();
  }

  // API pública
  const HUD = {
    position: S.position, // 'top' | 'bottom'
    setPosition(pos){ if (pos==='top' || pos==='bottom') { S.position = pos; HUD.position = pos; } },
    togglePosition(){ S.position = (S.position === 'top') ? 'bottom' : 'top'; HUD.position = S.position; },

    init(opts){
      if (opts && opts.position) HUD.setPosition(opts.position);
      // Tecla H para conmutar arriba/abajo (opcional)
      window.addEventListener('keydown', (e) => {
        if (e.key === 'h' || e.key === 'H') HUD.togglePosition();
      });
      const G = getG();
      if (G && typeof G === 'object' && typeof G.onUrgenciasStateChanged !== 'function') {
        G.onUrgenciasStateChanged = (open) => {
          G.urgenciasOpen = !!open;
        };
      }
    },

    // Render principal del HUD como BARRA superior o inferior
    render(ctx, _camera, Gref){
      const G = Gref || getG();
      if (!ctx || !G) return;
      const canvas = ctx.canvas;
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const cssW = canvas.clientWidth || canvas.width || 0;
      const cssH = canvas.clientHeight || canvas.height || 0;
      if (canvas.__hudDpr !== dpr){
        canvas.__hudDpr = dpr;
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const panelWidth = Math.min(cssW - S.pad * 2, 480);
      const panelHeight = S.height;
      const panelX = S.pad;
      const panelY = (S.position === 'top') ? S.pad : Math.max(S.pad, cssH - panelHeight - S.pad);

      ctx.save();
      ctx.fillStyle = THEME.bg;
      ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
      ctx.strokeStyle = '#19c37d';
      ctx.lineWidth = 2;
      ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelWidth - 1, panelHeight - 1);

      const halves = Number(G.health || 0);
      const maxHearts = Math.max(1, ((G.healthMax | 0) ? (G.healthMax | 0) / 2 : (G.player?.hpMax || 3)));
      const healthRatio = Math.max(0, Math.min(1, (maxHearts > 0 ? halves / (maxHearts * 2) : 1)));
      const tNow = (G.time != null) ? G.time : (performance.now() / 1000);
      const bps = 1.2 + (3.0 * (1 - healthRatio));
      const phase = (tNow * bps) % 1;
      const p1 = Math.pow(Math.max(0, 1 - Math.abs((phase - 0.06) / 0.12)), 3.2);
      const p2 = Math.pow(Math.max(0, 1 - Math.abs((phase - 0.38) / 0.18)), 3.0);
      const pulse = Math.min(1, p1 * 1.0 + p2 * 0.85);
      const amp = 0.16 + 0.28 * (1 - healthRatio);
      const squash = 0.10 + 0.24 * (1 - healthRatio);
      const scaleX = 1 + amp * pulse;
      const scaleY = 1 - squash * pulse;
      const glow = 0.25 + 0.65 * pulse;

      const heartsX = panelX + 18;
      const heartsY = panelY + 18;
      drawHearts(ctx, heartsX, heartsY, halves, maxHearts, scaleX, scaleY, glow);

      const snap = window.patientsSnapshot ? window.patientsSnapshot() : {
        total: G.stats?.totalPatients || 0,
        pending: G.stats?.remainingPatients || 0,
        cured: G.stats?.furiosasNeutralized || 0,
        furious: G.stats?.activeFuriosas || 0,
      };
      const remaining = snap.pending || 0;
      const cured = snap.cured || 0;
      const total = snap.total || 0;
      const furiosas = snap.furious || 0;
      const urgOpen = (G?.urgenciasOpen === true) || (remaining === 0 && furiosas === 0);

      const statsX = heartsX + 22 * maxHearts + 20;
      const statsY = panelY + 20;
      ctx.font = S.font;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillStyle = THEME.text;
      const pacLine = `Pacientes: ${cured}/${total}`;
      ctx.fillText(pacLine, statsX, statsY);
      let cursor = statsX + ctx.measureText(pacLine).width + 16;
      ctx.fillStyle = THEME.text;
      const pendLine = `Pendientes: ${remaining}`;
      ctx.fillText(pendLine, cursor, statsY);
      cursor += ctx.measureText(pendLine).width + 16;
      ctx.fillStyle = furiosas > 0 ? '#ff6b6b' : THEME.text;
      const furLine = `Furiosas: ${furiosas}`;
      ctx.fillText(furLine, cursor, statsY);
      cursor += ctx.measureText(furLine).width + 16;
      ctx.fillStyle = urgOpen ? THEME.ok : THEME.warn;
      // pinta en la línea siguiente para que no se solape
      ctx.fillText(`Urgencias: ${urgOpen ? 'ABIERTO' : 'CERRADO'}`, statsX, statsY + 18);

      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.text;
      ctx.fillText(`Puntos: ${G.score ?? 0}`, panelX + panelWidth - 18, statsY);
      ctx.textAlign = 'left';

      const infoWidth = panelX + panelWidth - statsX - 24;
      let infoY = statsY + 24;
      const carry = G.player?.carry || G.carry;
      if (infoWidth > 40 && carry){
        ctx.fillStyle = THEME.text;
        const c1 = ellipsize(ctx, `Llevas: ${carry.label || '—'}`, infoWidth);
        ctx.fillText(c1, statsX, infoY);
        infoY += 18;
        const c2 = ellipsize(ctx, `→ Para: ${carry.patientName || carry.pairName || '—'}`, infoWidth);
        ctx.fillText(c2, statsX, infoY);
        infoY += 18;
        if (carry.anagram){
          ctx.fillStyle = '#9fb0cc';
          ctx.fillText(ellipsize(ctx, `Pista: ${carry.anagram}`, infoWidth), statsX, infoY);
          ctx.fillStyle = THEME.text;
          infoY += 18;
        }
      }

      const objetivoRaw = computeObjective(G);
      const objectiveWidth = panelWidth - 36;
      const basePx = parseInt(S.font, 10) || 14;
      const { px, lines } = fitAndWrap(ctx, basePx, objetivoRaw, objectiveWidth, 2, 12);
      ctx.font = `${px}px monospace`;
      ctx.fillStyle = THEME.accent;
      ctx.textAlign = 'center';
      const objectiveX = panelX + panelWidth * 0.5;
      const objectiveTop = panelY + panelHeight - (lines.length > 1 ? px * 2 + 6 : px + 8);
      if (lines.length <= 1){
        ctx.fillText(lines[0] || objetivoRaw, objectiveX, objectiveTop);
      } else {
        ctx.fillText(lines[0], objectiveX, objectiveTop);
        ctx.fillText(lines[1], objectiveX, objectiveTop + px + 6);
      }

      ctx.restore();
    }
  };

  HUD.drawWorldOverlays = function(ctx, camera, G) {
    drawNameTags(ctx, camera, G);
    drawFloatingMessages(ctx, camera, G);
  };

  HUD.showFloatingMessage = showFloatingMessage;

  W.HUD = HUD;
  // Inicializa con posición por defecto (móvil abajo / PC arriba)
  HUD.init({});
})();