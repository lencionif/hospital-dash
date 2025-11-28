(function (root) {
  'use strict';

  const XMLRules = root.XMLRules = root.XMLRules || {};

  const cache = {
    docPromise: null,
    globals: null,
    levels: new Map()
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

  function parseSize(value) {
    if (!value) return null;
    if (typeof value === 'object' && Number.isFinite(value.w) && Number.isFinite(value.h)) {
      return { w: value.w, h: value.h };
    }
    if (typeof value !== 'string') return null;
    const parts = value.split('x').map((v) => parseInt(v.trim(), 10)).filter((n) => Number.isFinite(n));
    if (parts.length === 2) {
      return { w: parts[0], h: parts[1] };
    }
    const square = parseInt(value, 10);
    if (Number.isFinite(square)) {
      return { w: square, h: square };
    }
    return null;
  }

  function buildSizeRange(minValue, maxValue, fallback) {
    const minParsed = parseSize(minValue) || fallback?.min || fallback;
    const maxParsed = parseSize(maxValue) || fallback?.max || fallback;
    const minW = Math.max(1, parseInt(minParsed?.w, 10) || 0);
    const minH = Math.max(1, parseInt(minParsed?.h, 10) || 0);
    const maxW = Math.max(minW, parseInt(maxParsed?.w, 10) || minW);
    const maxH = Math.max(minH, parseInt(maxParsed?.h, 10) || minH);
    return { minW, minH, maxW, maxH };
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
    const roomFallback = buildSizeRange(level.roomSizeMin, level.roomSizeMax, { min: { w: 6, h: 6 }, max: { w: 12, h: 10 } });
    const roomFallbackRange = { min: { w: roomFallback.minW, h: roomFallback.minH }, max: { w: roomFallback.maxW, h: roomFallback.maxH } };
    const controlFallback = buildSizeRange(level.controlRoomSizeMin ?? level.roomSizeMin, level.controlRoomSizeMax ?? level.roomSizeMax, roomFallbackRange);
    const bossFallback = buildSizeRange(level.bossRoomSizeMin ?? level.roomSizeMin, level.bossRoomSizeMax ?? level.roomSizeMax, roomFallbackRange);
    const corridorMin = resolveNumber(level.corridorWidthMin, globals.corridorWidthMin, 1) || 1;
    const corridorMaxCandidate = resolveNumber(level.corridorWidthMax, globals.corridorWidthMax, Math.max(corridorMin, 2));
    const corridorMax = Number.isFinite(corridorMaxCandidate) ? Math.max(corridorMin, corridorMaxCandidate) : Math.max(corridorMin, 2);
    const culling = resolveCulling(globals, level);

    return {
      id: level.id ?? level.level ?? '1',
      width: resolveNumber(level.width, globals.width),
      height: resolveNumber(level.height, globals.height),
      rooms: resolveNumber(level.rooms, globals.rooms),
      culling,
      corridorWidthMin: corridorMin,
      corridorWidthMax: corridorMax,
      room: {
        normal: roomFallback,
        control: controlFallback,
        boss: bossFallback
      },
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
      deprecated: {
        bossRoom: level.bossRoom
      }
    };
  }

})(typeof window !== 'undefined' ? window : globalThis);
