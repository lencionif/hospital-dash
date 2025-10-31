// filename: doors.entities.js
// Puertas — Hospital Dash
// Reglas:
//  - Se instancian cerradas.
//  - SOLO Jugador y NPCs pueden abrir/cerrar (sin apertura por impactos).
//  - La Boss Door nace bloqueada y se abre automáticamente cuando no quedan pacientes normales.
//  - Compatible con placement.plugin.js → Entities.Door.spawn(x,y,{ locked, isBoss })
//  - Sprites: usa ENT.DOOR y la flag e.solid (cerrada) / !e.solid (abierta).

(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  ENT.DOOR = ENT.DOOR || 'door';

  W.Entities = W.Entities || {};
  const E = W.Entities;

  const TILE = (W.TILE_SIZE || W.TILE || 32);

  // ===== Helpers de tipo de actor que puede operar puertas =====
  function isPlayer(actor) {
    return !!actor && (actor.isPlayer === true || actor.kind === ENT.PLAYER);
  }
  function isNPC(actor) {
    // centralízalo si tienes E.NPC; aquí usamos heurística genérica
    return !!actor && (actor.isNPC === true || (actor.kind && String(actor.kind).toLowerCase().includes('npc')));
  }
  function canOperateDoor(actor) {
    return isPlayer(actor) || isNPC(actor);
  }

  // ===== Motor de puertas =====
  const Doors = {
    _bossUnlocked: false,

    // Crear puerta en coordenadas de MUNDO (px); placement.plugin.js ya te da px
    spawn(x, y, opts = {}) {
      const e = {
        kind: ENT.DOOR,
        x: (x|0), y: (y|0),
        w: TILE, h: TILE,
        vx: 0, vy: 0,
        // estado
        open: false,
        solid: true,      // cerrada → bloquea
        locked: !!opts.locked || !!opts.isBoss,   // boss nace bloqueada
        isBossDoor: !!opts.isBoss || !!opts.isBossDoor,
        autoClose: (opts.autoClose !== false),    // autocierre por defecto
        autoCloseDelay: Number.isFinite(opts.autoCloseDelay) ? opts.autoCloseDelay : 1.0, // s
        _openTimer: 0,
        // API por entidad (opcional si tu motor la usa)
        tryOpen(by){ return Doors.tryOpen(this, by); },
        tryClose(by){ return Doors.tryClose(this, by); },
        toggle(by){ return Doors.toggle(this, by); },
      };

      // empuja a listas
      G.entities = G.entities || [];
      G.entities.push(e);
      G.doors = G.doors || [];
      G.doors.push(e);

      return e;
    },

    // Interacción “manual”: llama esto cuando el jugador pulsa E o cuando un NPC llega a la puerta
    interact(actor, rangeMul = 1) {
      if (!actor || !canOperateDoor(actor)) return false;
      const d = this._closestDoorInFront(actor, rangeMul);
      if (!d) return false;
      // Si está cerrada → abrir (si no está bloqueada). Si está abierta → cerrar.
      return d.open ? this.tryClose(d, actor) : this.tryOpen(d, actor);
    },

    // Auto-apertura por proximidad/colisión (para pathfinding de NPCs o paso del jugador)
    // Llama a esto desde tu detección de colisiones o en el update.
    proximityOpenFor(actor) {
      if (!actor || !canOperateDoor(actor)) return;
      for (const d of (G.doors || [])) {
        if (!d) continue;
        if (this._aabb(actor, d)) {
          this.tryOpen(d, actor);
        }
      }
    },

    // Cerrar automáticamente si no hay nadie atravesando la puerta tras un delay
    update(dt = 0.016) {
      // Regla Boss: abrir cuando no quedan pacientes normales
      this._autoUnlockBossIfNoNormals();

      const doors = (G.doors || []);
      for (const d of doors) {
        if (!d) continue;

        // Autocierre con retardo
        if (d.open && d.autoClose) {
          // si hay alguien (player o npc) dentro, reinicia el temporizador
          if (this._someoneInside(d)) {
            d._openTimer = 0;
          } else {
            d._openTimer += dt;
            if (d._openTimer >= d.autoCloseDelay) {
              // Las de boss permanecen abiertas (no se cierran una vez abiertas)
              if (!d.isBossDoor) this.tryClose(d);
            }
          }
        }
      }
    },

    tryOpen(door, by) {
      if (!door) return false;
      if (door.locked) {
        // feedback opcional
        this._sfx('door_locked');
        return false;
      }
      if (door.open) return true;
      door.open = true;
      door.solid = false;
      door._openTimer = 0;
      this._sfx('door_open');
      return true;
    },

    tryClose(door, by) {
      if (!door) return false;
      if (door.isBossDoor) return false; // la boss queda abierta
      if (!door.open) return true;
      door.open = false;
      door.solid = true;
      door._openTimer = 0;
      this._sfx('door_close');
      return true;
    },

    toggle(door, by) {
      if (!door) return false;
      return door.open ? this.tryClose(door, by) : this.tryOpen(door, by);
    },

    // ===== Regla Boss: abre cuando no hay pacientes "normales" =====
    _autoUnlockBossIfNoNormals() {
      if (this._bossUnlocked) return;
      const bossDoor = (G.doors || []).find(d => d.isBossDoor);
      if (!bossDoor) return;

      // Cuenta pacientes “normales” vivos en el mapa
      // Heurística: ENT.PATIENT y que NO sea boss/special/defunct
      const normalsAlive = (G.patients || G.entities || []).some(p =>
        p && (p.kind === ENT.PATIENT) &&
        !p.isBoss && !p.special && !p.dead && !p.removed
      );

      if (!normalsAlive) {
        bossDoor.locked = false;       // ya no está bloqueada
        this.tryOpen(bossDoor);        // ábrela automáticamente
        this._bossUnlocked = true;
      }
    },

    // ===== Utilidades =====
    _closestDoorInFront(actor, rangeMul = 1) {
      const T = TILE;
      const range = Math.max(T * 0.75, Math.min(T * 1.5, (T * 1.0) * rangeMul));
      const dir = actor.lastDir || { x: Math.sign(actor.vx || 0), y: Math.sign(actor.vy || 0) };
      const px = actor.x + (actor.w ? actor.w / 2 : 0);
      const py = actor.y + (actor.h ? actor.h / 2 : 0);
      const tx = px + dir.x * range;
      const ty = py + dir.y * range;

      let best = null, bd = 1e9;
      for (const d of (G.doors || [])) {
        if (!d) continue;
        const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
        const dist = Math.hypot(cx - tx, cy - ty);
        if (dist < bd) { best = d; bd = dist; }
      }
      return best;
    },

    _someoneInside(door) {
      const list = G.entities || [];
      for (const e of list) {
        if (!e || e === door) continue;
        if (!canOperateDoor(e)) continue;          // solo player/NPC cuentan
        if (this._aabb(e, door)) return true;
      }
      return false;
    },

    _aabb(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x &&
             a.y < b.y + b.h && a.y + a.h > b.y;
    },

    _sfx(key) {
      // hook opcional a tu audio api
      if (W.Audio && typeof W.Audio.play === 'function') {
        try { W.Audio.play(key); } catch (e) {}
      }
    }
  };

  // API pública
  E.Door = Doors;

})(this);