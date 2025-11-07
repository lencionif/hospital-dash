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
    const result = { globals, level, rules };
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

})(typeof window !== 'undefined' ? window : globalThis);
