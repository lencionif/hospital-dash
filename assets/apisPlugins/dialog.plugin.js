/* filename: dialog.plugin.js
   Canvas Dialog API – “Il Divo: Hospital Dash!”
   ------------------------------------------------------------
   • Ventana emergente (canvas overlay) con retrato opcional.
   • Pausa el juego (G.state="PAUSED") al abrir y lo reanuda al cerrar.
   • Botones, colas de pasos, y acertijos con input y pistas.
   • Mensajes de sistema (toasts) dibujados en el mismo canvas.
   • Sin dependencias externas. Cargar ANTES de game.js.
   ------------------------------------------------------------ */

(function () {
  'use strict';

  // ---------- Config visual ----------
  const Z_INDEX = 20000;                   // por encima de HUD/luces
  const THEME = {
    backdrop: 'rgba(10,12,20,0.55)',
    cardBg:   'rgba(16,18,28,0.96)',
    cardBorder: 'rgba(255,255,255,0.10)',
    title:    '#ffd98a',
    text:     '#d7e0f2',
    hint:     '#9fb0cc',
    accent:   '#8ae6ff',
    danger:   '#ff6b6b',
    success:  '#7cf29a',
    buttonBg: '#262c3e',
    buttonBgHover: '#2f3750',
    buttonText: '#e8f0ff',
    inputBg:  '#1a1f2d',
    inputBorder: 'rgba(255,255,255,0.14)',
    shadow:   'rgba(0,0,0,0.55)',
    toastBg:  'rgba(18,20,30,0.96)',
    toastBorder: 'rgba(255,255,255,0.10)'
  };

  // ---------- Estado ----------
  let canvas, ctx, dpr=1;
  let runningRAF = 0;
  let openDialog = null;    // {title, text, portraitImg, buttons[], ...}
  let restoreState = null;  // {state:'PLAYING'|'PAUSED'}
  let hoverButton = -1;
  let pointerDown = false;
  let keyListenerAttached = false;
  const imgCache = new Map();
  const toasts = [];        // {msg, t0, ms}

  // ---------- Inicialización de canvas ----------
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'dialogCanvas';
    Object.assign(canvas.style, {
      position: 'fixed',
      left: '0', top: '0',
      width: '100vw', height: '100vh',
      zIndex: String(Z_INDEX),
      pointerEvents: 'none', // se activa cuando hay diálogo abierto
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Pointer events
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('mousedown', e => { pointerDown = true; });
    canvas.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('mouseleave', ()=>{ hoverButton=-1; pointerDown=false; });
  }

  function resizeCanvas(){
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio||1));
    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    // CSS size ya es 100vw/100vh
  }

  // ---------- Pausa / reanudar ----------
  function pauseGame(){
    const G = window.G || (window.G = {});
    restoreState = { state: G.state };
    G.state = 'PAUSED';
    try { G.Audio?.duck?.(true); } catch(e){}
  }
  function resumeGame(){
    const G = window.G || (window.G = {});
    if (restoreState) G.state = restoreState.state || 'PLAYING';
    restoreState = null;
    try { G.Audio?.duck?.(false); } catch(e){}
  }

  // ---------- Util draw ----------
  function clear() {
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
  }
  function fillRectR(x,y,w,h,r,color,shadow=false){
    const rr = Math.min(r, w*0.5, h*0.5);
    ctx.save();
    if (shadow){
      ctx.shadowColor = THEME.shadow;
      ctx.shadowBlur  = 22;
      ctx.shadowOffsetY = 10;
    }
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x,y,w,h, rr); }
    else {
      // simple rounded rect
      const r=rr; const r2 = r*2;
      ctx.moveTo(x+r,y);
      ctx.arcTo(x+w,y,x+w,y+h,r);
      ctx.arcTo(x+w,y+h,x,y+h,r);
      ctx.arcTo(x,y+h,x,y,r);
      ctx.arcTo(x,y,x+w,y,r);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  function strokeRectR(x,y,w,h,r,color,weight=1){
    const rr = Math.min(r, w*0.5, h*0.5);
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x,y,w,h,rr);
    else {
      const r=rr;
      ctx.moveTo(x+r,y);
      ctx.arcTo(x+w,y,x+w,y+h,r);
      ctx.arcTo(x+w,y+h,x,y+h,r);
      ctx.arcTo(x,y+h,x,y,r);
      ctx.arcTo(x,y,x+w,y,r);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = weight;
    ctx.stroke();
    ctx.restore();
  }
  function drawText(text, x,y, size=16, color=THEME.text, align='left', bold=false){
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${bold?'700':'500'} ${size}px Inter, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  function drawMultiline(text, x,y, maxW, lh, size=15, color=THEME.text){
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `500 ${size}px Inter, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif`;
    const words = (text||'').split(/\s+/);
    let line = '', yy = y;
    for (let i=0;i<words.length;i++){
      const t = line ? (line+' '+words[i]) : words[i];
      const w = ctx.measureText(t).width;
      if (w > maxW && line){
        ctx.fillText(line, x, yy);
        line = words[i];
        yy += lh;
      } else {
        line = t;
      }
    }
    if (line) ctx.fillText(line, x, yy);
    ctx.restore();
  }

  // ---------- Imagen retrato ----------
  function getCssVarUrl(varName){
    try{
      const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (!v) return null;
      const m = v.match(/url\((.*?)\)/i);
      return m ? m[1].replace(/^["']|["']$/g, '') : v.replace(/^["']|["']$/g, '');
    }catch(e){ return null; }
  }
  function loadImage(src){
    if (!src) return Promise.resolve(null);
    if (imgCache.has(src)) return Promise.resolve(imgCache.get(src));
    return new Promise(res=>{
      const im = new Image();
      im.onload = ()=>{ imgCache.set(src, im); res(im); };
      im.onerror = ()=> res(null);
      im.src = src;
    });
  }

  // ---------- Apertura / Cierre ----------
  function open(opts){
    ensureCanvas();

    // Resolver retrato
    const resolvePortrait = async ()=>{
      let img = null;
      if (opts.portraitCssVar){
        const url = getCssVarUrl(opts.portraitCssVar);
        if (url) img = await loadImage(url);
      } else if (opts.portraitUrl){
        img = await loadImage(opts.portraitUrl);
      }
      return img;
    };

    resolvePortrait().then(img=>{
      // Estructura de diálogo activo
      openDialog = {
        title: opts.title || ' ',
        text:  opts.text || '',
        hint:  opts.hint || '',
        allowEsc: opts.allowEsc !== false,
        closeOnBackdrop: !!opts.closeOnBackdrop,
        input: !!opts.input,      // para acertijos
        inputValue: '',
        inputPlaceholder: opts.inputPlaceholder || '',
        inputNormalize: opts.inputNormalize !== false,
        portraitImg: img,
        buttons: normalizeButtons(opts.buttons),
        riddle: opts.riddle || null,  // {validAnswers[], onSuccess, onFail, maxAttempts, attempt, hints[]}
        width: Math.min(760, Math.max(480, opts.width||680)),
        onClose: opts.onClose || null
      };
      canvas.style.pointerEvents = 'auto';
      attachKeys();
      pauseGame();
      startRAF();
    });
  }

  function close(){
    if (!openDialog) return;
    try { openDialog.onClose?.(); } catch(e){}
    openDialog = null;
    canvas.style.pointerEvents = (toasts.length>0) ? 'none' : 'none';
    detachKeys();
    resumeGame();
    // si no hay toasts, paramos loop
    if (toasts.length===0) stopRAF();
    redraw(); // limpiar
  }

  function normalizeButtons(btns){
    const def = [{ label:'Aceptar', primary:true, action: null }];
    const list = Array.isArray(btns) && btns.length ? btns : def;
    return list.map((b,i)=>({
      label: b.label || `Opción ${i+1}`,
      primary: !!b.primary || (i===0 && !b.primary===undefined),
      close: b.close !== false,
      id: b.id || ('btn'+i),
      action: typeof b.action==='function' ? b.action : null
    }));
  }

  // ---------- Acertijos ----------
  function normalizeText(s){
    if (s==null) return '';
    s = String(s);
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.toLowerCase().replace(/\s+/g,' ').trim();
    return s;
  }

  function openRiddle(opts){
    const o = Object.assign({
      title: 'Acertijo',
      ask: '¿…?',
      answers: [],
      hints: [],
      maxAttempts: 2,
      portraitCssVar: null,
      portraitUrl: null,
      onSuccess: null,
      onFail: null,
      allowEsc: false
    }, opts||{});

    const valid = (Array.isArray(o.answers)?o.answers:[o.answers]).map(normalizeText);

    open({
      title: o.title,
      text:  o.ask,
      hint:  '', // la iremos mostrando
      input: true,
      inputPlaceholder: 'Escribe tu respuesta…',
      inputNormalize: true,
      allowEsc: o.allowEsc,
      portraitCssVar: o.portraitCssVar,
      portraitUrl: o.portraitUrl,
      buttons: [
        { label:'Responder', primary:true, action: ({value})=>{
            const v = normalizeText(value);
            const ok = valid.includes(v);
            if (ok){
              try { o.onSuccess?.({value:v}); } catch(e){}
              system('¡Correcto!', {ms:1100});
              close();
            } else {
              // buscar diálogo actual
              if (!openDialog.riddle) {
                openDialog.riddle = { attempt: 1, maxAttempts:o.maxAttempts, hints:o.hints, onSuccess:o.onSuccess, onFail:o.onFail };
              } else {
                openDialog.riddle.attempt++;
              }
              const a = openDialog.riddle.attempt;
              if (a < o.maxAttempts){
                openDialog.hint = o.hints[a-1] || '';
                system('Incorrecto. ¡Inténtalo de nuevo!', {ms:1200});
              } else {
                try { o.onFail?.({value:v}); } catch(e){}
                system('Fallaste el acertijo.', {ms:1200});
                close();
              }
            }
          }},
        { label:'Cancelar', close:true, action: ()=>{ try{o.onFail?.({cancel:true});}catch(e){}; } }
      ],
      riddle: { valid, attempt:0, maxAttempts:o.maxAttempts, hints:o.hints, onSuccess:o.onSuccess, onFail:o.onFail }
    });
  }

  // ---------- Queue / Toast ----------
  async function queue(steps){
    if (!Array.isArray(steps) || !steps.length) return;
    for (let i=0;i<steps.length;i++){
      await new Promise(resolve=>{
        open(Object.assign({}, steps[i], {
          buttons: normalizeButtons(steps[i].buttons || [{label: i<steps.length-1?'Siguiente':'Cerrar', primary:true, action:()=>resolve()}]),
          onClose: ()=>resolve()
        }));
      });
      close();
    }
  }

  function system(msg, {ms=1600}={}){
    ensureCanvas();
    toasts.push({ msg:String(msg), t0: performance.now(), ms });
    startRAF();
  }

  // ---------- Input & Eventos ----------
  function attachKeys(){
    if (keyListenerAttached) return;
    window.addEventListener('keydown', onKeyDown, true);
    keyListenerAttached = true;
  }
  function detachKeys(){
    if (!keyListenerAttached) return;
    window.removeEventListener('keydown', onKeyDown, true);
    keyListenerAttached = false;
  }
  function onKeyDown(e){
    if (!openDialog) return;

    if (e.key === 'Escape' && openDialog.allowEsc){
      e.preventDefault(); close(); return;
    }
    if (openDialog.input){
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey){
        if (openDialog.inputValue.length < 64) openDialog.inputValue += e.key;
        e.preventDefault();
      } else if (e.key === 'Backspace'){
        openDialog.inputValue = openDialog.inputValue.slice(0,-1);
        e.preventDefault();
      } else if (e.key === 'Enter'){
        // disparar botón primario
        const b = openDialog.buttons.find(b=>b.primary) || openDialog.buttons[0];
        if (b) clickButton(b);
        e.preventDefault();
      }
    } else {
      if (e.key === 'Enter'){
        const b = openDialog.buttons.find(b=>b.primary) || openDialog.buttons[0];
        if (b) clickButton(b);
        e.preventDefault();
      }
    }
  }

  function onPointerMove(e){
    if (!openDialog) return;
    const {cardRect, btnRects} = measureLayout();
    const p = eventPoint(e);
    hoverButton = -1;
    for (let i=0;i<btnRects.length;i++){
      const r = btnRects[i];
      if (p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h){ hoverButton = i; break; }
    }
    redraw();
  }

  function onPointerUp(e){
    if (!openDialog) return;
    if (!pointerDown){ return; }
    pointerDown = false;

    const {btnRects} = measureLayout();
    const p = eventPoint(e);
    for (let i=0;i<btnRects.length;i++){
      const r = btnRects[i];
      if (p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h){
        const b = openDialog.buttons[i];
        clickButton(b);
        return;
      }
    }

    // Click fuera → cerrar si closeOnBackdrop
    const {cardRect} = measureLayout();
    if (openDialog.closeOnBackdrop){
      if (!(p.x>=cardRect.x && p.x<=cardRect.x+cardRect.w && p.y>=cardRect.y && p.y<=cardRect.y+cardRect.h)){
        close();
      }
    }
  }

  function clickButton(b){
    let keepOpen = false;
    try {
      const ctx = { value: openDialog.input ? openDialog.inputValue : undefined };
      const r = b?.action?.(ctx);
      if (r === false) keepOpen = true;
    } catch(e){}
    if (b.close !== false && !keepOpen) close();
  }

  function eventPoint(e){
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    return { x, y };
  }

  // ---------- Layout ----------
  function measureLayout(){
    const W = canvas.width/dpr, H = canvas.height/dpr;
    const cw = Math.min(openDialog?.width||680, W - 40);
    const ch = Math.min(420, H - 80);
    const cx = (W - cw)/2;
    const cy = (H - ch)/2;
    const pad = 16;

    const leftColW = 110;
    const hasPortrait = !!openDialog?.portraitImg;

    const titleY = cy + pad;
    const bodyX  = cx + (hasPortrait ? (pad+leftColW+pad) : pad);
    const bodyY  = titleY + 30;
    const bodyW  = cw - (hasPortrait ? (leftColW+pad*3) : pad*2);
    const btnY   = cy + ch - 16 - 40;

    // buttons size
    const btnRects = [];
    if (openDialog){
      let bx = bodyX;
      for (let i=0;i<openDialog.buttons.length;i++){
        const label = openDialog.buttons[i].label;
        ctx.save(); ctx.font = `700 15px Inter, system-ui, sans-serif`;
        const tw = ctx.measureText(label).width;
        ctx.restore();
        const w = Math.max(90, tw + 28);
        const h = 36;
        btnRects.push({ x: bx, y: btnY, w, h });
        bx += w + 10;
      }
    }

    // input rect (si riddle)
    const inputRect = openDialog?.input ? {
      x: bodyX, y: btnY - 50, w: bodyW, h: 36
    } : null;

    return {
      W,H, cw,ch, cx,cy, pad,
      leftColW, hasPortrait,
      titleY, bodyX, bodyY, bodyW, btnY,
      cardRect: {x:cx, y:cy, w:cw, h:ch},
      btnRects, inputRect
    };
  }

  // ---------- Render ----------
  function redraw(){
    clear();
    const now = performance.now();

    // Toasts (se dibujan aunque no haya diálogo)
    drawToasts(now);

    if (!openDialog) return;

    const L = measureLayout();

    // backdrop
    ctx.fillStyle = THEME.backdrop;
    ctx.fillRect(0,0,L.W,L.H);

    // card
    fillRectR(L.cx, L.cy, L.cw, L.ch, 16, THEME.cardBg, true);
    strokeRectR(L.cx, L.cy, L.cw, L.ch, 16, THEME.cardBorder, 1);

    // retrato
    if (L.hasPortrait){
      const px = L.cx + L.pad;
      const py = L.titleY - 2;
      const pw = L.leftColW, ph = L.leftColW;
      fillRectR(px, py, pw, ph, 12, '#121522');
      strokeRectR(px, py, pw, ph, 12, THEME.cardBorder, 1);
      if (openDialog.portraitImg){
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px+2, py+2, pw-4, ph-4, 10);
        else { ctx.rect(px+2, py+2, pw-4, ph-4); }
        ctx.clip();
        ctx.drawImage(openDialog.portraitImg, px+2, py+2, pw-4, ph-4);
        ctx.restore();
      }
    }

    // título
    drawText(openDialog.title, L.hasPortrait ? (L.cx+L.pad+L.leftColW+L.pad) : (L.cx+L.pad), L.titleY, 18, THEME.title, 'left', true);

    // cuerpo
    drawMultiline(openDialog.text, L.bodyX, L.bodyY, L.bodyW, 22, 15, THEME.text);

    // hint (acertijo)
    if (openDialog.hint){
      drawMultiline(openDialog.hint, L.bodyX, L.bodyY + 120, L.bodyW, 20, 14, THEME.hint);
    }

    // input (acertijo)
    if (L.inputRect){
      fillRectR(L.inputRect.x, L.inputRect.y, L.inputRect.w, L.inputRect.h, 8, THEME.inputBg);
      strokeRectR(L.inputRect.x, L.inputRect.y, L.inputRect.w, L.inputRect.h, 8, THEME.inputBorder, 1);
      const txt = openDialog.inputValue || '';
      const placeholder = openDialog.inputPlaceholder || '';
      drawText(txt || placeholder, L.inputRect.x+10, L.inputRect.y+9, 15, txt?THEME.text:'#8a93a8');
      // cursor parpadeo
      if ((Math.floor(performance.now()/500)%2)===0){
        const w = ctx.measureText(txt).width;
        ctx.fillStyle = THEME.accent;
        ctx.fillRect(L.inputRect.x+10+w+2, L.inputRect.y+8, 2, L.inputRect.h-16);
      }
    }

    // botones
    for (let i=0;i<L.btnRects.length;i++){
      const r = L.btnRects[i];
      const b = openDialog.buttons[i];
      const hov = (i===hoverButton);
      fillRectR(r.x, r.y, r.w, r.h, 10, hov ? THEME.buttonBgHover : THEME.buttonBg);
      strokeRectR(r.x, r.y, r.w, r.h, 10, b.primary ? THEME.accent : THEME.cardBorder, b.primary?2:1);
      ctx.save();
      ctx.font = `700 15px Inter, system-ui, sans-serif`;
      ctx.fillStyle = THEME.buttonText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, r.x + r.w/2, r.y + r.h/2 + 1);
      ctx.restore();
    }
  }

  function drawToasts(now){
    // limpiar expirados
    for (let i=toasts.length-1; i>=0; i--){
      const t = toasts[i];
      const a = (now - t.t0) / t.ms;
      if (a >= 1.0) toasts.splice(i,1);
    }
    if (toasts.length===0) return;

    const W = canvas.width/dpr;
    let y = 14;
    for (const t of toasts){
      const a = (now - t.t0) / t.ms;
      const alpha = a<0.1 ? (a/0.1) : (a>0.9 ? (1-(a-0.9)/0.1) : 1);
      const msg = t.msg;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = `600 14px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(msg).width;
      const padX = 14, padY = 8;
      const bw = tw + padX*2, bh = 32;
      const bx = (W - bw)/2, by = y;
      fillRectR(bx, by, bw, bh, 10, THEME.toastBg);
      strokeRectR(bx, by, bw, bh, 10, THEME.toastBorder, 1);
      ctx.fillStyle = THEME.text;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(msg, bx + bw/2, by + bh/2 + 1);
      ctx.restore();
      y += bh + 8;
    }
  }

  // ---------- RAF loop ----------
  function startRAF(){
    if (runningRAF) return;
    const loop = ()=>{
      runningRAF = requestAnimationFrame(loop);
      redraw();
      if (!openDialog && toasts.length===0){
        stopRAF();
      }
    };
    loop();
  }
  function stopRAF(){
    if (runningRAF){ cancelAnimationFrame(runningRAF); runningRAF=0; }
    clear();
  }

  // ---------- API pública ----------
  const DialogAPI = {
    // Dialogo simple
    open(opts){
      open(Object.assign({
        title:'Diálogo',
        text:'',
        buttons:[{label:'OK', primary:true}],
        allowEsc:true,
        closeOnBackdrop:false
      }, opts||{}));
      return this;
    },
    // Acertijo
    openRiddle(opts){
      openRiddle(opts||{});
      return this;
    },
    // Cola de pasos
    queue(steps){
      queue(steps||[]);
      return this;
    },
    // Cerrar actual
    close(){
      close();
      return this;
    },
    // Mensaje de sistema (toast)
    system(msg, o){ system(msg, o||{}); return this; },
    // Tema (colores)
    setTheme(theme){
      Object.assign(THEME, theme||{});
      redraw();
      return this;
    }
  };

  // Exponer global
  window.DialogAPI = DialogAPI;

})();