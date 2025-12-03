(function (root) {
  'use strict';

  const XMLRules = root.XMLRules = root.XMLRules || {};
  const LevelRulesAPI = root.LevelRulesAPI = root.LevelRulesAPI || {};

  const cache = {
    docPromise: null,
    globals: null,
    levels: new Map(),
    levelConfigs: new Map()
  };

  const cssEscape = root.CSS?.escape
    ? (value) => root.CSS.escape(String(value))
    : (value) => String(value).replace(/"/g, '\\"');

  XMLRules.load = async function load(levelId) {
    const id = String(levelId || '1');
    if (cache.levels.has(id)) {
      return cache.levels.get(id);
    }

    const doc = await ensureDocument();
    const globals = cache.globals || parseGlobals(doc);
    cache.globals = globals;

    const levelNode = doc.querySelector(`level[id="${cssEscape(id)}"]`) || doc.querySelector('level');
    if (!levelNode) {
      throw new Error(`XMLRules: level ${id} not found in level_rules.xml`);
    }

    const level = parseLevel(levelNode, globals);
    const rules = parseRules(levelNode);
    const config = buildLevelConfig({ globals, level, rules });
    const result = { globals, level, rules, config };
    cache.levels.set(id, result);
    return result;
  };

  LevelRulesAPI.loadAllOnce = async function loadAllOnce() {
    const doc = await ensureDocument();
    const globals = cache.globals || parseGlobals(doc);
    cache.globals = globals;

    const levels = Array.from(doc.querySelectorAll('levels > level'));
    const configs = new Map();
    for (const node of levels) {
      const attrs = parseAttributes(node);
      const id = String(attrs.id ?? attrs.level ?? configs.size + 1);
      if (cache.levelConfigs.has(id)) {
        configs.set(id, cache.levelConfigs.get(id));
        continue;
      }
      const level = parseLevel(node, globals);
      const rules = parseRules(node);
      const config = buildLevelConfig({ globals, level, rules });
      const enriched = { ...config, mode: 'normal' };
      cache.levelConfigs.set(id, enriched);
      cache.levels.set(id, { globals, level, rules, config });
      configs.set(id, enriched);
    }
    return configs;
  };

  LevelRulesAPI.getLevelConfig = async function getLevelConfig(levelId, mode = 'normal') {
    const id = String(levelId || '1');
    if (cache.levelConfigs.has(id)) {
      const cfg = cache.levelConfigs.get(id);
      const withMode = { ...cfg, mode: mode || cfg.mode || 'normal' };
      LevelRulesAPI.current = withMode;
      const legacy = root.LevelRules || (root.LevelRules = {});
      legacy.current = withMode;
      return withMode;
    }

    const data = await XMLRules.load(id);
    const base = data?.config || {};
    const config = { ...base, mode: mode || base.mode || 'normal' };
    cache.levelConfigs.set(id, config);
    LevelRulesAPI.current = config;
    const legacy = root.LevelRules || (root.LevelRules = {});
    legacy.current = config;
    return config;
  };

  LevelRulesAPI.getNumber = function getNumber(path, fallback = null) {
    const src = LevelRulesAPI.current || cache.globals || {};
    if (!path || typeof path !== 'string') return fallback;
    const parts = path.split('.').filter(Boolean);
    let node = src;
    for (const p of parts) {
      if (node && Object.prototype.hasOwnProperty.call(node, p)) {
        node = node[p];
      } else {
        node = undefined;
        break;
      }
    }
    const num = Number(node);
    return Number.isFinite(num) ? num : fallback;
  };

  async function ensureDocument() {
    if (cache.docPromise) return cache.docPromise;
    cache.docPromise = fetch('assets/config/level_rules.xml')
      .then((resp) => {
        if (!resp.ok) throw new Error(`XMLRules: HTTP ${resp.status}`);
        return resp.text();
      })
      .then((txt) => new DOMParser().parseFromString(txt, 'application/xml'))
      .catch((err) => {
        cache.docPromise = null;
        throw err;
      });
    return cache.docPromise;
  }

  function parseGlobals(doc) {
    const node = doc.querySelector('levels > globals');
    if (!node) return {};
    return parseAttributes(node);
  }

  function parseLevel(node, globals) {
    const attrs = parseAttributes(node);
    const G = root.G || (root.G = {});
    const resolvedSeed = (attrs.seed === 'auto' || attrs.seed === 'AUTO' || attrs.seed == null)
      ? (G.seed || Date.now())
      : attrs.seed;
    const level = {
      ...attrs,
      seed: resolvedSeed,
      spawn: parseChild(node, 'spawn'),
      minimap: parseChild(node, 'minimap'),
      lighting: parseChild(node, 'lighting'),
      legend: parseChild(node, 'legend')
    };
    if (typeof level.heroes === 'number' && typeof globals?.maxHeroes === 'number') {
      level.heroes = Math.min(level.heroes, globals.maxHeroes);
    }
    return level;
  }

  function parseRules(node) {
    const out = [];
    node.querySelectorAll(':scope > rule').forEach((ruleNode) => {
      const data = parseAttributes(ruleNode);
      data._tagName = ruleNode.tagName.toLowerCase();
      out.push(data);
    });
    return out;
  }

  function groupRulesByType(rules = []) {
    const grouped = {
      patient: [],
      npc: [],
      enemy: [],
      cart: [],
      door: [],
      elevator: [],
      light: [],
      phone: [],
      other: []
    };

    for (const rule of rules) {
      const type = String(rule?.type || rule?._tagName || '').toLowerCase();
      if (grouped[type]) {
        grouped[type].push(rule);
      } else {
        grouped.other.push(rule);
      }
    }

    return grouped;
  }

  function parseChild(node, selector) {
    const child = node.querySelector(`:scope > ${selector}`);
    if (!child) return null;
    const data = parseAttributes(child);
    data._tagName = child.tagName.toLowerCase();
    return data;
  }

  function parseAttributes(node) {
    const out = {};
    if (!node || !node.attributes) return out;
    for (const attr of node.attributes) {
      out[attr.name] = autoType(attr.value);
    }
    return out;
  }

  function autoType(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed.length) return '';
    const lower = trimmed.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (lower === 'auto') return 'auto';
    if (/^[-+]?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    if (/^[-+]?\d*\.\d+$/.test(trimmed)) return parseFloat(trimmed);
    return trimmed;
  }

  function resolveNumber(...values) {
    for (const value of values) {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return null;
  }

  function resolveCulling(globals, level) {
    const rawLevel = resolveNumber(level?.culling);
    const rawGlobal = resolveNumber(globals?.culling);
    return rawLevel ?? rawGlobal ?? 20;
  }

  function buildLevelConfig({ globals = {}, level = {}, rules = [] } = {}) {
    const culling = resolveCulling(globals, level);
    const rulesByType = groupRulesByType(rules);

    return {
      id: level.id ?? level.level ?? '1',
      width: resolveNumber(level.width, globals.width),
      height: resolveNumber(level.height, globals.height),
      rooms: resolveNumber(level.rooms, globals.rooms),
      culling,
      heroes: resolveNumber(level.heroes, globals.maxHeroes),
      difficulty: resolveNumber(level.difficulty, globals.difficulty),
      boss: level.boss,
      cooling: resolveNumber(level.cooling, globals.cooling),
      seed: level.seed,
      spawn: level.spawn || null,
      minimap: level.minimap || null,
      lighting: level.lighting || null,
      legend: level.legend || null,
      globals,
      rules,
      rulesByType,
      patientRules: rulesByType.patient,
      npcRules: rulesByType.npc,
      enemyRules: rulesByType.enemy,
      cartRules: rulesByType.cart,
      doorRules: rulesByType.door,
      elevatorRules: rulesByType.elevator,
      lightRules: rulesByType.light,
      phoneRules: rulesByType.phone,
      otherRules: rulesByType.other,
      deprecated: {
        bossRoom: level.bossRoom,
        bossRoomFlag: level.bossRoom === 'big',
        roomSizeMin: level.roomSizeMin,
        roomSizeMax: level.roomSizeMax,
        controlRoomSizeMin: level.controlRoomSizeMin,
        controlRoomSizeMax: level.controlRoomSizeMax,
        bossRoomSizeMin: level.bossRoomSizeMin,
        bossRoomSizeMax: level.bossRoomSizeMax,
        corridorWidthMin: level.corridorWidthMin,
        corridorWidthMax: level.corridorWidthMax
      }
    };
  }

})(typeof window !== 'undefined' ? window : globalThis);
