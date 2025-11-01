(() => {
  'use strict';

  // === Config/tema por defecto ===
  const THEME = {
    bg:    '#0b0d10',
    text:  '#e6edf3',
    ok:    '#2ecc71',
    warn:  '#e67e22',
    accent:'#f6c44f',
    stroke:'#ff5a6b',
  };

  const S = {
    position: (('ontouchstart' in window) ? 'bottom' : 'top'), // móvil: abajo; PC: arriba
    height: 68,
    pad: 12,
    font: '14px monospace',
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
    if (G.carry && (G.carry.label || G.carry.patientName)) {
      const pill = G.carry.label || 'la pastilla';
      const who  = G.carry.patientName || 'el paciente asignado';
      return `Objetivo: entrega ${pill} a ${who}`;
    }

    // 3) Si no llevas → buscar una para un paciente (usa vínculos si existen)
    const hayPacientes = Array.isArray(G.patients) && G.patients.length > 0;
    const hayPills     = Array.isArray(G.pills)     && G.pills.length     > 0;
    if (!G.carry && hayPacientes) {
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
    const stats = G?.stats || {};
    const remaining = stats.remainingPatients || 0;
    const total = stats.totalPatients || 0;
    const furiosas = stats.activeFuriosas || 0;
    const urgOpen = remaining === 0 && furiosas === 0;
    const r = { x: 12, y: 12, w: 260, h: 64 };
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
    ctx.fillText(`Pacientes restantes: ${remaining} / ${total}`, r.x + 12, r.y + 24);
    ctx.fillStyle = furiosas > 0 ? '#ff6b6b' : '#9aa6b1';
    ctx.fillText(`Furiosas activas: ${furiosas}`, r.x + 12, r.y + 42);
    ctx.fillStyle = urgOpen ? '#ffd166' : '#9aa6b1';
    ctx.fillText(`Urgencias: ${urgOpen ? 'ABIERTO' : 'CERRADO'}`, r.x + 12, r.y + 60);
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
    },

    // Render principal del HUD como BARRA superior o inferior
    render(ctx, _camera, Gref){
      const G = Gref || getG();
      if (!ctx || !G) return;
      const Wc = ctx.canvas.width, Hc = ctx.canvas.height;
      const y0 = (S.position === 'top') ? 0 : (Hc - S.height);

      // Limpiar y fondo de barra
      ctx.clearRect(0, 0, Wc, Hc);
      ctx.save();
      ctx.fillStyle = THEME.bg;
      ctx.globalAlpha = 0.72;
      ctx.fillRect(0, y0, Wc, S.height);
      ctx.globalAlpha = 1;

      // Tipografía
      ctx.font = S.font;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = THEME.text;

      // Layout simple: [L] hearts + stats | [C] objetivo | [R] score
      const leftX  = S.pad;
      const midX   = Wc * 0.35;
      const rightX = Wc - S.pad;
      const cy     = y0 + (S.height / 2);
      // ——— L: Vida + stats (latido fuerte) ———
      const halves = Number(G.health || 0);
      const maxHearts = Math.max(1, ((G.healthMax | 0) ? (G.healthMax | 0) / 2 : (G.player?.hpMax || 3)));
      const healthRatio = Math.max(0, Math.min(1, (maxHearts > 0 ? halves / (maxHearts * 2) : 1)));

      // Tiempo base (usa el reloj del juego si existe)
      const tNow = (G.time != null) ? G.time : (performance.now() / 1000);

      // Velocidad del pulso: con poca vida va MUCHO más rápido
      const bps = 1.2 + (3.0 * (1 - healthRatio)); // 1.2 .. 4.2 latidos/seg

      // Patrón “lub-dub”: dos golpes por ciclo (uno corto y otro un pelín más largo)
      const phase = (tNow * bps) % 1;             // 0..1
      const p1 = Math.pow(Math.max(0, 1 - Math.abs((phase - 0.06) / 0.12)), 3.2); // golpe 1
      const p2 = Math.pow(Math.max(0, 1 - Math.abs((phase - 0.38) / 0.18)), 3.0); // golpe 2
      const pulse = Math.min(1, p1 * 1.0 + p2 * 0.85); // mezcla

      // Amplitud y squash: con poca vida se exageran
      const amp    = 0.16 + 0.28 * (1 - healthRatio); // 16% .. 44% de crecimiento horizontal
      const squash = 0.10 + 0.24 * (1 - healthRatio); // 10% .. 34% de “aplastado” vertical

      const scaleX = 1 + amp * pulse;   // ensancha
      const scaleY = 1 - squash * pulse; // aplasta (efecto cartoon)
      const glow   = 0.25 + 0.65 * pulse; // 0.25..0.90 → halo muy visible en el pico

      drawHearts(ctx, leftX, cy - 14, halves, maxHearts, scaleX, scaleY, glow);
      let lx = leftX + 22*maxHearts + 14;


      ctx.fillStyle = THEME.text;
      const stats = G.stats || {};
      const remaining = stats.remainingPatients || 0;
      const total = stats.totalPatients || 0;
      const furiosas = stats.activeFuriosas || 0;
      const urgOpen = remaining === 0 && furiosas === 0;
      ctx.fillStyle = THEME.text;
      ctx.textAlign = 'left';
      const pacLine = `Pacientes: ${remaining}/${total}`;
      ctx.fillText(pacLine, lx, cy - 18);
      lx += ctx.measureText(pacLine).width + 16;
      ctx.fillStyle = furiosas > 0 ? THEME.warn : THEME.text;
      const furLine = `Furiosas: ${furiosas}`;
      ctx.fillText(furLine, lx, cy - 18);
      lx += ctx.measureText(furLine).width + 16;
      ctx.fillStyle = urgOpen ? THEME.ok : THEME.warn;
      const urg = `Urgencias: ${urgOpen ? 'ABIERTO' : 'CERRADO'}`;
      ctx.fillText(urg, lx, cy - 18);

      // Info de lo que llevas (si aplica)
      if (G.carry) {
        ctx.fillStyle = THEME.text;
        const c1 = `Llevas: ${G.carry.label || '—'}`;
        const c2 = `→ Para: ${G.carry.patientName || G.carry.pairName || '—'}`;
        const heartsBlockW = 22*maxHearts + 14;
        ctx.fillText(c1, leftX + heartsBlockW, cy + 2);
        const anagram = G.carry.anagram ? `Pista: ${G.carry.anagram}` : '';
        const carryOffset = leftX + heartsBlockW + ctx.measureText(c1).width + 14;
        ctx.fillText(c2, carryOffset, cy + 2);
        if (anagram) {
          ctx.fillText(anagram, carryOffset + ctx.measureText(c2).width + 14, cy + 2);
        }
      }

      // ——— C: Objetivo (fit 2 líneas + auto-shrink) ———
      const objetivoRaw = computeObjective(G);
      const midWidth = Wc * 0.50;       // más ancho para el centro
      ctx.textAlign = 'center';
      ctx.fillStyle = THEME.accent;

      const basePx = parseInt(S.font, 10) || 14;
      const { px, lines } = fitAndWrap(ctx, basePx, objetivoRaw, midWidth, 2, 11);

      const oldFont = ctx.font;
      ctx.font = `${px}px monospace`;
      if (lines.length <= 1) {
        ctx.fillText(lines[0] || objetivoRaw, Wc * 0.50, cy);
      } else {
        ctx.fillText(lines[0], Wc * 0.50, cy - 10);
        ctx.fillText(lines[1], Wc * 0.50, cy + 10);
      }
      ctx.font = oldFont;


      // ——— R: Score ———
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.text;
      ctx.fillText(`Puntos: ${G.score ?? 0}`, rightX, cy);

      drawPatientsCounterPanel(ctx, G);

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