// filename: ai.registry.plugin.js
// Registro unificado de IA. Permite adjuntar comportamientos por entidad y
// sistemas globales que se ejecutan cada frame desde game.js.
(function (W) {
  'use strict';

  const LOG = () => W.LOG || null;

  function toKey(name) {
    return String(name || '').trim().toUpperCase();
  }

  const AI = {
    _entities: new Map(),
    _systems: new Map(),
    _order: [],

    attach(ent, name) {
      const key = toKey(name);
      if (!ent || !key) return;
      ent.aiId = key;
      if (typeof ent.ai === 'string' && ent.ai !== key) {
        ent.aiTag = key;
      }
    },

    register(name, handler) {
      const key = toKey(name);
      if (!key || typeof handler !== 'function') return;
      this._entities.set(key, handler);
      LOG()?.info?.('[AI] register entity', { key });
      this._ensureOrder(key, 'entity');
    },

    registerSystem(name, handler) {
      const key = toKey(name);
      if (!key || typeof handler !== 'function') return;
      this._systems.set(key, handler);
      LOG()?.info?.('[AI] register system', { key });
      this._ensureOrder(key, 'system');
    },

    _ensureOrder(key, type) {
      if (this._order.find((it) => it.key === key)) return;
      this._order.push({ key, type });
    },

    update(state, dt) {
      const G = state || W.G || (W.G = {});

      for (const [key, handler] of this._systems.entries()) {
        try {
          handler(G, dt);
        } catch (err) {
          LOG()?.warn?.('[AI] system error', { key, err });
        }
      }

      const list = Array.isArray(G.entities) ? G.entities : [];
      for (const ent of list) {
        if (!ent || ent.dead) continue;
        const key = toKey(ent.aiId || (typeof ent.ai === 'string' ? ent.ai : ent.aiTag));
        if (!key) continue;
        const handler = this._entities.get(key);
        if (!handler) continue;
        try {
          handler(ent, G, dt);
        } catch (err) {
          LOG()?.warn?.('[AI] entity error', { key, entity: ent.id || ent.kind || null, err });
        }
      }
    },

    summarize() {
      const active = {
        entities: Array.from(this._entities.keys()),
        systems: Array.from(this._systems.keys()),
      };
      LOG()?.info?.('AI_SUMMARY', active);
      return active;
    }
  };

  W.AI = AI;
})(window);
