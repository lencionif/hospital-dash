/* ============================================================================
 *  Il Divo - SpritesAPI (Atlas + Dibujado + Suelo/Pared + Visor)
 *  - Carga unificada de sprites desde ./assets/images/
 *  - Manifest por orden: <script id="sprites-manifest"> (inline) -> fetch('manifest.json')
 *  - Tolerante: si faltan imágenes, NO revienta (Promise.allSettled).
 *  - Dibujo del suelo ajedrezado y de las paredes (tiles: 'suelo.png'/'pared.png').
 *  - Asignación automática de sprite por entidad (usa window.ENT si existe).
 *  - Visor de sprites (F9) con miniaturas y nombres.
 *  - Sin getImageData (evita "tainted canvas" en file://). Tintes por composición.
 * ========================================================================== */
(function (global) {
  'use strict';

  const Sprites = {
    _opts: { basePath: './assets/images/', tile: 32 },
    _imgs: Object.create(null),       // mapa: key -> HTMLImageElement/Canvas
    _keys: [],                        // lista de keys cargadas (orden del manifest)
    _ready: false,
    _viewer: { enabled: false, page: 0, perRow: 10, thumb: 48 },
    _isHttp: /^https?:/i.test(location.protocol),
    _base: function(){ return this._opts.basePath.replace(/\/+$/,'') + '/'; },

    init(opts = {}) {
      this._opts = { ...this._opts, ...opts };
      // toggle visor con F9
      window.addEventListener('keydown', (e) => {
        if (e.key === 'F9' || e.key === 'f9') {
          this._viewer.enabled = !this._viewer.enabled;
        }
      });
      global.Sprites = this; // expón por si otros scripts lo necesitan
      return this;
    },

    // -----------------------------
    // PRELOAD (tolerante a fallos)
    // -----------------------------
    async preload() {
      const names = await this._pathsFromManifest(); // nombres ('.png'/.jpg)
      const paths = names.map(n => this._base() + n);

      const results = await Promise.allSettled(paths.map(p => this._loadImage(p)));
      const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      const ko = results.filter(r => r.status === 'rejected');

      if (ko.length) {
        console.warn('[Sprites] Algunas rutas fallaron (continuamos):', ko.map(k => k.reason?.url || k.reason));
      }

      // indexa por clave "limpia" (nombre sin extensión)
      for (const it of ok) {
        const key = this._keyFromUrl(it.src);
        this._imgs[key] = it;
        if (!this._keys.includes(key)) this._keys.push(key);
      }

      // variantes suaves para el suelo (ajedrez claro/oscuro) sin getImageData
      if (this._imgs['suelo']) {
        this._imgs['suelo_claro'] = this._makeTintComposite(this._imgs['suelo'], 'screen', 'rgba(255,255,255,0.22)');
        this._imgs['suelo_oscuro'] = this._makeTintComposite(this._imgs['suelo'], 'multiply', 'rgba(0,0,0,0.18)');
      }
      // por si faltase, crea un placeholder generico
      if (!this._imgs['suelo']) this._imgs['suelo'] = this._makePlaceholder('#546e7a');
      if (!this._imgs['pared']) this._imgs['pared'] = this._makePlaceholder('#8d6e63');

      this._ready = true;
    },

    async _pathsFromManifest() {
      // 1) Inline: <script id="sprites-manifest" type="application/json">[...]</script>
      const inline = document.getElementById('sprites-manifest');
      if (inline && inline.textContent.trim().length) {
        try {
          const arr = JSON.parse(inline.textContent.trim());
          if (Array.isArray(arr) && arr.length) return arr;
        } catch (e) {
          console.warn('[Sprites] manifest inline JSON inválido:', e);
        }
      }

      // 2) Global (por si lo inyectas en otro script): window.SPRITES_MANIFEST = [...]
      if (Array.isArray(global.SPRITES_MANIFEST) && global.SPRITES_MANIFEST.length) {
        return global.SPRITES_MANIFEST.slice();
      }

      // 3) fetch('manifest.json') — solo si NO estás en file://
      if (this._isHttp) {
        try {
          const url = this._base() + 'manifest.json';
          const res = await fetch(url, { cache: 'no-cache' });
          const json = await res.json();
          if (Array.isArray(json) && json.length) return json;
        } catch (e) {
          console.warn('[Sprites] manifest error:', e);
        }
      } else {
        console.warn('[Sprites] Estás en file:// → no se puede hacer fetch(manifest.json). Usa el manifest inline.');
      }

      // 4) Fallback vacío (seguimos; dibujaremos placeholders si faltan)
      return [];
    },

    _loadImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        // Solo pedimos CORS cuando estamos en http(s). En file:// no toques crossOrigin.
        if (this._isHttp) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (ev) => reject({ url, ev });
        img.src = url;
      });
    },

    _keyFromUrl(src) {
      const file = src.split('/').pop().split('?')[0];
      return file.replace(/\.(png|jpg|jpeg|gif)$/i, '');
    },

    _makePlaceholder(color = '#777') {
      const t = this._opts.tile|0 || 32;
      const c = document.createElement('canvas');
      c.width = t; c.height = t;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, t, t);
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.beginPath();
      g.moveTo(0,0); g.lineTo(t,t); g.moveTo(t,0); g.lineTo(0,t); g.stroke();
      return c;
    },

    // “Tinte” por composición (sin getImageData → compatible con file://)
    _makeTintComposite(img, mode, color) {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = mode;   // 'screen' (aclara), 'multiply' (oscurece)
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'source-over';
      return c;
    },

    // ---------------------------------------------------------
    // DIBUJO DEL MUNDO: suelo ajedrezado + paredes + entidades
    // ---------------------------------------------------------
    drawFloorAndWalls(ctx, G) {
      if (!G || !Array.isArray(G.map)) return;
      const T = (this._opts.tile|0) || (global.TILE_SIZE|0) || 32;
      for (let y = 0; y < G.mapH; y++) {
        for (let x = 0; x < G.mapW; x++) {
          const px = x * T, py = y * T;
          const isWall = !!G.map[y][x];
          if (isWall) {
            const img = this._imgs['pared'];
            img ? ctx.drawImage(img, px, py, T, T) : (ctx.fillStyle='#5d4037', ctx.fillRect(px,py,T,T));
          } else {
            // ajedrez (clarito/normal)
            const useLight = ((x + y) & 1) === 0;
            const img = useLight ? (this._imgs['suelo_claro'] || this._imgs['suelo'])
                                 : (this._imgs['suelo_oscuro'] || this._imgs['suelo']);
            img ? ctx.drawImage(img, px, py, T, T) : (ctx.fillStyle='#37474f', ctx.fillRect(px,py,T,T));
          }
        }
      }
    },

    drawEntity(ctx, e) {
      if (!e || e.dead) return;

      const T = (this._opts.tile|0) || (global.TILE_SIZE|0) || 32;
      const key = this._keyForEntity(e) || '';
      const img = this._imgs[key];

      // Fallback seguro si no hay sprite
      if (!img) {
        ctx.fillStyle = e.color || '#888';
        ctx.fillRect(e.x|0, e.y|0, e.w|0, e.h|0);
        // contorno suave
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(e.x|0+0.5, e.y|0+0.5, e.w|0-1, e.h|0-1);
        return;
      }
      ctx.drawImage(img, e.x|0, e.y|0, e.w|0, e.h|0);
    },

    // Mapea entidad → nombre de sprite (por defecto)
    _keyForEntity(e) {
      // Si la entidad ya trae spriteKey/skin, úsalo
      if (e.spriteKey) return e.spriteKey;
      if (e.skin) return e.skin;

      const ENT = global.ENT || {};
      switch (e.kind) {
        case ENT.PLAYER:   return ''; // el jugador lo dibuja PuppetAPI
        case ENT.MOSQUITO: return 'mosquito';
        case ENT.RAT:      return 'raton';
        case ENT.CART: {
          // Prioriza sprite explícito si la factoría lo puso
          const s = (e.spriteKey || e.skin || '').toLowerCase();
          if (s) return s;

          // Si viene como subtipo / tipo (placement o factoría)
          const sub = (e.sub || e.type || '').toLowerCase();
          if (sub.includes('food') || sub.includes('comida')) return 'carro_comida';
          if (sub.includes('med')  || sub.includes('medic'))  return 'carro_medicinas';
          if (sub.includes('urg')  || sub.includes('er'))     return 'carro_urgencias';

          // Por defecto: medicación
          return 'carro_medicinas';
        }
        case ENT.PATIENT: return (e.spriteKey || e.skin || 'paciente_en_cama');
        case ENT.BOSS: {
          // Usa sprite explícito si lo trae la factoría; si no, primer boss del manifiesto
          const s = (e.spriteKey || e.skin || '').toLowerCase();
          return s || 'boss_nivel1';
        }
        case ENT.PILL: {
          // Si la factoría ya puso sprite/skin, respétalo; si trae "name" mapea a pastilla_<name>
          if (e.spriteKey || e.skin) return (e.spriteKey || e.skin);
          const n = (e.name || e.label || 'azul').toLowerCase();
          return 'pastilla_' + n;
        }
        case ENT.DOOR: {
          // La puerta de boss la pone su API; si no trae skin, usa un genérico si lo tienes o deja fallback
          return (e.spriteKey || e.skin || '');
        }
        case ENT.LIGHT:   return 'light_1';

        // ✅ Soporta NPC genérico (si tu ENT tiene .NPC)
        case ENT.NPC: {
          // Usa lo que haya: spriteKey / skin / rol
          const k = (e.spriteKey || e.skin || e.role || '').toLowerCase();
          if (k) return k;
          // fallback razonable
          return 'medico';
        };
        default:           return ''; // que pinte fallback
      }
    },

    // HUD / overlays opcionales del visor de sprites (F9)
    renderOverlay(ctx) {
      if (!this._viewer.enabled) return;
      const { thumb, perRow } = this._viewer;
      const PAD = 8, y0 = 8;

      // fondo
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#0b0d10';
      ctx.fillRect(6, 6, (thumb+PAD)*perRow + 16, 360);
      ctx.globalAlpha = 1;

      // título
      ctx.fillStyle = '#e6edf3';
      ctx.font = '12px monospace';
      ctx.fillText('SPRITES VIEWER (F9 para ocultar) — ' + this._keys.length + ' sprites', 12, y0 + 12);

      // grid
      let x = 12, y = y0 + 24, col = 0;
      for (const k of this._keys) {
        const img = this._imgs[k];
        if (img) ctx.drawImage(img, x, y, thumb, thumb);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.strokeRect(x+0.5, y+0.5, thumb, thumb);

        // nombre
        ctx.fillStyle = '#cfd8dc';
        ctx.fillText(k, x, y + thumb + 12);

        col++;
        x += thumb + PAD;
        if (col >= perRow) { col = 0; x = 12; y += thumb + 28; }
        if (y > 330) break; // cabe en la caja
      }
      ctx.restore();
    }
  };

  // API pública
  global.Sprites = Sprites;

})(window);