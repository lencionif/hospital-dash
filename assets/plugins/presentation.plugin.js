// presentation.api.js — Intro de viñetas automática (cinemática)
(function (W, D) {
  'use strict';

  // --- configuración de viñetas (26)
  const FRAME_NUMBERS = Array.from({length: 26}, (_, i) => i + 1);
  const LOGO_FRAME = 26; // ← viñeta del logo final (vuelo obligatorio)
  const BOOK_FRAMES = new Set([4,5,6,7,11,15,21]); // páginas de "libro": +tiempo
  const IMG_WITH  = n => IMG(`Intro/viñeta-${n}.png`);
  const IMG_WOUT  = n => IMG(`Intro/vineta-${n}.png`);


  // --- estado
  let overlay, img, started = false, idx = -1, timer = 0;

  // --- DOM overlay
  function ensureDOM(){
    overlay = D.getElementById('introOverlay');
    if (!overlay){
      overlay = D.createElement('div');
      overlay.id = 'introOverlay';
      overlay.innerHTML = `<img id="introFrame" alt="intro frame" />
        <div class="ui"><span class="hint">Pulsa una tecla o haz clic para comenzar.</span></div>`;
      D.body.appendChild(overlay);
    }
    img = overlay.querySelector('#introFrame');
    // estilo mínimo para el fade del propio <img>
    img.style.opacity = 0;
    img.style.transition = 'opacity .45s ease';
  }

  // --- util: carga con fallback (con/sin tilde) + último recurso (logo_juego.png)
  function setSrc(n, cb){
    const primary = IMG_WITH(n);
    const fallback= IMG_WOUT(n);
    let triedFallback = false;

    img.onerror = () => {
      if (!triedFallback) {                 // 1º intento: sin tilde
        triedFallback = true;
        img.src = fallback;
        return;
      }
      // 2º intento: si es el logo final o ha fallado todo, usa el logo del juego
      img.onerror = null;
      if (n === LOGO_FRAME) img.src = IMG('logo_juego.png');
      cb && cb(); // continúa aunque no cargue la imagen (no bloquea la animación)
    };
    img.onload  = () => cb && cb();
    img.src = primary;
  }


  // --- tiempos por viñeta (sincronía ligera con la música)
  function msFor(n){
    const base = 2100;           // 2.1s por defecto
    const extra= BOOK_FRAMES.has(n) ? 1100 : 0;  // +1.1s si es “libro”
    return base + extra;
  }

  const __PRES_LISTENERS__ = [];
  function __on(el, ev, fn, opts){ el?.addEventListener?.(ev, fn, opts); __PRES_LISTENERS__.push([el,ev,fn,opts]); }
  function __unbindAll__(){ for (const [el,ev,fn,opts] of __PRES_LISTENERS__) { try{ el?.removeEventListener?.(ev, fn, opts); }catch(_){ } } __PRES_LISTENERS__.length = 0; }

  // --- NUEVO: permitir saltar la intro con tecla/clic (una sola vez)
function bindSkip(){
  if (W.__introSkipBound) return;
  W.__introSkipBound = true;

  let unlocked = false;
  let skipArmed = false;
  const hint = () => overlay && overlay.querySelector('.hint');

  // 1º gesto → activa audio y COMIENZA el pase de viñetas
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    try {
      if (window.MusicAPI?.playIntro) {
        if (!window.__introMusicStarted) {
          window.__introMusicStarted = true;      // ← marca que ya suena la intro
          MusicAPI.playIntro({ fade: 0.2 });
        }
      }
    } catch(_) {}
    if (hint()) hint().textContent = 'Intro en curso… pulsa cualquier tecla o clic para saltarla.';
    beginSlides(); // programa next() a partir de la viñeta 1

    // Evita que el mismo gesto dispare el salto
    setTimeout(() => { skipArmed = true; }, 280);

    // 2º gesto → SALTO al final (vuelo del logo)
    const skip = () => { if (!skipArmed) return; logoFly(); };
  __on(window, 'keydown',     skip, { once:true, capture:true });
  __on(window, 'pointerdown', skip, { once:true, passive:true, capture:true });
  __on(overlay, 'pointerdown', skip, { once:true, passive:true, capture:true });
  };

__on(window, 'keydown',     unlock, { once:true, capture:true });
__on(window, 'pointerdown', unlock, { once:true, passive:true, capture:true });
__on(overlay, 'pointerdown', unlock, { once:true, passive:true, capture:true });
}

  // --- iniciar el pase automático de viñetas DESPUÉS del primer gesto
  function beginSlides(){
    if (W.__slidesRunning) return;
    W.__slidesRunning = true;
    clearTimeout(timer);
    // ya estamos mostrando la 1; programa salto a la 2 cuando toque
    timer = setTimeout(next, msFor(1));
  }

  // --- pasar a la siguiente viñeta con fade in/out
  function next(){
    idx++;
    if (idx >= FRAME_NUMBERS.length) return logoFly();

    const n = FRAME_NUMBERS[idx];
    img.style.opacity = 0;

    setTimeout(() => {
      setSrc(n, () => {
        requestAnimationFrame(() => { img.style.opacity = 1; });
        clearTimeout(timer);
        timer = setTimeout(next, msFor(n));
      });
    }, 220);
  }

  function start(){
    if (started) return;
    started = true;

    // Muestra la PRIMERA viñeta en pausa (sin música aún)
    overlay.style.display = 'grid';
    overlay.classList.add('visible');

    // Marca que la 1 ya está en pantalla y deja la animación parada
    idx = 1;
    setSrc(1, () => { requestAnimationFrame(() => { img.style.opacity = 1; }); });

    // El primer gesto desbloquea audio y DA COMIENZO a las diapositivas
    bindSkip();
  }

  // VUELO OBLIGATORIO: muestra el LOGO_FRAME, lo encoge y lo mueve a la esquina con destello.
  function logoFly(){
    if (W.__logoFlew) return finish();   // evita doble ejecución
    W.__logoFlew = true;

    clearTimeout(timer);
    overlay.classList.add('visible');

    // Asegura que, si el navegador bloqueó audio, al primer gesto o aquí suene.
    try{
      if (W.MusicAPI && MusicAPI.playIntro) {
        if (!window.__introMusicStarted) { window.__introMusicStarted = true; MusicAPI.playIntro({ fade: 0.3 }); } // no reintentar si ya sonaba
      }
    }catch(_){}

    // Carga la viñeta del LOGO y ANIMA hacia la esquina
    setSrc(LOGO_FRAME, () => {
      img.style.opacity = 1;                 // logo a pantalla
      img.classList.remove('to-corner');     // reinicia anim por si ya estaba
      void img.offsetWidth;                  // fuerza reflow del navegador
// Calcula destino (esquina sup-dcha de la FOTO del start-screen)
const menu = D.getElementById('start-screen');
if (menu) menu.classList.remove('hidden');        // visible para medir
const sr = menu ? menu.getBoundingClientRect() : D.body.getBoundingClientRect();
const r0 = img.getBoundingClientRect();
const MARGIN = 16;
const targetScale = 0.14;                          // tamaño final del logo
const targetW = r0.width  * targetScale;
const targetH = r0.height * targetScale;

// Centro actual del logo (antes de volar)
const curCx = r0.left + r0.width  / 2;
const curCy = r0.top  + r0.height / 2;
// Centro objetivo del logo arriba-dcha de la foto
const tgtCx = sr.right - MARGIN - targetW/2;
const tgtCy = sr.top   + MARGIN + targetH/2;

// Traducciones para @keyframes (desde el centro al centro)
overlay.style.setProperty('--tc-x', (tgtCx - curCx) + 'px');
overlay.style.setProperty('--tc-y', (tgtCy - curCy) + 'px');
overlay.style.setProperty('--tc-scale', targetScale);

// Lanza la animación
img.classList.add('to-corner');

// Al terminar, mueve logo+halo DENTRO del start-screen en la MISMA posición/tamaño
img.addEventListener('animationend', () => {
  img.classList.remove('to-corner');
  img.style.opacity = '1';

  const r = img.getBoundingClientRect();          // posición final en viewport

  // Crea el contenedor definitivo dentro del start-screen
  let wrap = D.getElementById('brandWrap');
  if (!wrap) {
    wrap = D.createElement('div');
    wrap.id = 'brandWrap';
    wrap.className = 'brand-wrap';
    menu.appendChild(wrap);
  }
  // Posición y tamaño EXACTOS usando las mismas metas del vuelo (sin “medir” nada)
  // (coinciden con la última keyframe de la animación)
  const finalLeft = tgtCx - targetW / 2;   // coordenadas absolutas en viewport
  const finalTop  = tgtCy - targetH / 2;

  // Posiciona el wrap respecto al #start-screen
  const Wpx = Math.round(targetW) + 'px';
  const Hpx = Math.round(targetH) + 'px';
  wrap.style.left   = Math.round(finalLeft - sr.left) + 'px';
  wrap.style.top    = Math.round(finalTop  - sr.top ) + 'px';
  wrap.style.width  = Wpx;
  wrap.style.height = Hpx;
  wrap.style.setProperty('--brand-w', Wpx); // por si tu CSS lo usa

  // Mueve el <img> dentro del wrap, fija su tamaño y limpia transform
  img.style.transform = 'none';
  img.style.width  = Wpx;
  img.style.height = 'auto';
  wrap.appendChild(img);

  // Crea/ajusta el halo “fuego” por detrás del logo (centrado y proporcional)
  let halo = wrap.querySelector('.brand-halo');
  if (!halo) {
    halo = D.createElement('div');
    halo.className = 'brand-halo';
    wrap.appendChild(halo);
  }
  halo.style.position = 'absolute';
  halo.style.left = '-10%';
  halo.style.top  = '-10%';
  halo.style.transform = 'translate(-50%,-50%)';
  halo.style.width  = `calc(${Wpx} * 1.25)`;   // 125% del logo
  halo.style.height = `calc(${Hpx} * 1.25)`;
  halo.style.pointerEvents = 'none';
  halo.style.zIndex = '0';

  // Quita el overlay: ya no se necesita
  overlay.remove();

  // Muestra el menú y dispara el evento de fin
  finish();
}, { once: true });
    });
  }

function finish(){
  __unbindAll__();   // ← elimina cualquier listener de la intro
  clearTimeout(timer);
  const menu = document.getElementById('start-screen');
  if (menu){
    menu.classList.remove('hidden');
    menu.style.animation = 'pa2FadeIn .45s ease';
  }
  window.dispatchEvent(new Event('intro:complete'));
}

  // API pública
  W.PresentationAPI = Object.assign(W.PresentationAPI || {}, {
    playIntroSequence(){
      ensureDOM();
      // intentamos arrancar inmediatamente (si el navegador bloquea audio,
      // la secuencia sigue pero quizá muteada; el usuario lo puede activar luego)
      start();
    }
  });

})(window, document);
