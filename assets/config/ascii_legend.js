(function (W) {
  'use strict';

  const root = typeof W !== 'undefined' ? W : window;

  root.AsciiLegend = {
    // Terreno / fuera del mapa
    '#': { key: 'wall',        kind: 'wall',        blocking: true },
    '.': { key: 'floor',       kind: 'floor',       blocking: false },
    ' ': { key: 'void',        kind: 'void',        blocking: false },

    // Posición del héroe / puntos especiales
    'S': { key: 'hero_spawn',  kind: 'hero_spawn',  factoryKey: 'hero_spawn', isSpawn: true },
    'X': { key: 'boss_main',   kind: 'boss_main',   factoryKey: 'boss_main_spawn', isBoss: true },
    'M': { key: 'mini_boss',   kind: 'mini_boss',   factoryKey: 'mini_boss_spawn', isMiniBoss: true },

    // Teléfono de control room
    'T': { key: 'phone_central', kind: 'phone',     factoryKey: 'phone_central' },

    // Luces
    'L': { key: 'light_ok',    kind: 'light_ok',    factoryKey: 'light_ok' },
    'l': { key: 'light_broken',kind: 'light_broken',factoryKey: 'light_broken' },

    // Pacientes
    'p': { key: 'patient_bed', kind: 'patient',     factoryKey: 'patient_normal', isPatient: true },
    'f': { key: 'patient_fury',kind: 'patient_fury',factoryKey: 'patient_furious_debug', isPatient: true },

    // Timbre asociado
    'b': { key: 'bell',        kind: 'bell',        factoryKey: 'bell_patient', isTrigger: true },

    // Puertas
    'd': { key: 'door_normal', kind: 'door',        factoryKey: 'door_normal' },
    'u': { key: 'door_boss',   kind: 'door_urg',    factoryKey: 'door_urgencias', bossDoor: true },

    // Spawns abstractos según level_rules
    'N': { key: 'spawn_npc',   kind: 'spawn_npc',   factoryKey: 'spawn_npc_human', isSpawn: true },
    'A': { key: 'spawn_animal',kind: 'spawn_animal',factoryKey: 'spawn_enemy_animal', isSpawn: true },
    'C': { key: 'spawn_cart',  kind: 'spawn_cart',  factoryKey: 'spawn_cart', isSpawn: true },

    // Carros colocados directamente
    'F': { key: 'cart_food',      kind: 'cart_food',      factoryKey: 'cart_food', isCart: true },
    'U': { key: 'cart_emergency', kind: 'cart_emergency', factoryKey: 'cart_emergency', isCart: true },
    '+': { key: 'cart_meds',      kind: 'cart_meds',      factoryKey: 'cart_meds', isCart: true },

    // Camas sueltas (sin paciente)
    'B': { key: 'bed',            kind: 'bed',            factoryKey: 'bed_empty' },

    // Enemigos animales
    'm': { key: 'mosquito',       kind: 'mosquito',       factoryKey: 'npc_mosquito', isEnemy: true },
    'r': { key: 'rat',            kind: 'rat',            factoryKey: 'npc_rat',      isEnemy: true },

    // Paciente furioso colocado directamente
    'P': { key: 'furious_patient',kind: 'furious_patient',factoryKey: 'npc_furious_patient', isEnemy: true },

    // NPC humanos concretos (colocados manualmente)
    'H': { key: 'npc_supervisora', kind: 'supervisora',   factoryKey: 'npc_supervisora', isNPC: true },
    'k': { key: 'npc_medico',      kind: 'medico',        factoryKey: 'npc_medico',      isNPC: true },
    't': { key: 'npc_tcae',        kind: 'tcae',          factoryKey: 'npc_tcae',        isNPC: true },
    'c': { key: 'npc_celador',     kind: 'celador',       factoryKey: 'npc_celador',     isNPC: true },
    'n': { key: 'npc_nurse_sexy',  kind: 'enfermera_sexy',factoryKey: 'npc_enfermera_sexy', isNPC: true },
    'h': { key: 'npc_cleaner',     kind: 'cleaner',       factoryKey: 'npc_cleaner',     isNPC: true },
    'g': { key: 'npc_guard',       kind: 'guardia',       factoryKey: 'npc_guardia',     isNPC: true },
    'v': { key: 'npc_familiar',    kind: 'familiar',      factoryKey: 'npc_familiar_molesto', isNPC: true },

    // Ascensor
    'E': { key: 'elevator',       kind: 'elevator',       factoryKey: 'elevator_tile' },

    // Agua / charco
    '~': { key: 'water',          kind: 'water',          factoryKey: 'water_tile', isWater: true },

    // Fuego
    'x': { key: 'fire',           kind: 'fire',           factoryKey: 'fire_tile',  isHazard: true },

    // Pastilla genérica
    'i': { key: 'pill',           kind: 'pill',           factoryKey: 'pill_generic' },

    // Loot genérico
    'o': { key: 'loot_random',    kind: 'loot_random',    factoryKey: 'loot_random' },

    // Monedas y bolsas
    '$': { key: 'coin',           kind: 'coin',           factoryKey: 'loot_coin' },
    '%': { key: 'money_bag',      kind: 'money_bag',      factoryKey: 'loot_money_bag' },

    // Jeringas (power-ups directos)
    '1': { key: 'syringe_red',    kind: 'syringe',        subtype: 'red',   factoryKey: 'syringe_red' },
    '2': { key: 'syringe_blue',   kind: 'syringe',        subtype: 'blue',  factoryKey: 'syringe_blue' },
    '3': { key: 'syringe_green',  kind: 'syringe',        subtype: 'green', factoryKey: 'syringe_green' },

    // Goteros (efectos tácticos)
    '4': { key: 'drip_red',       kind: 'drip',           subtype: 'red',   factoryKey: 'drip_red' },
    '5': { key: 'drip_blue',      kind: 'drip',           subtype: 'blue',  factoryKey: 'drip_blue' },
    '6': { key: 'drip_green',     kind: 'drip',           subtype: 'green', factoryKey: 'drip_green' },

    // Comida/bebida
    'y': { key: 'food_small',     kind: 'food',           subtype: 'small', factoryKey: 'food_small' },
    'Y': { key: 'food_big',       kind: 'food',           subtype: 'big',   factoryKey: 'food_big' },

    // Extintor portátil
    'e': { key: 'extinguisher',   kind: 'extinguisher',   factoryKey: 'extinguisher' }
  };

  root.PlacementAPI = root.PlacementAPI || {};

  const PlacementAPI = root.PlacementAPI;

  PlacementAPI.getCharForKey = function getCharForKey(key, fallback) {
    if (!key || typeof key !== 'string') return fallback;
    const legend = root.AsciiLegend || {};
    for (const [ch, def] of Object.entries(legend)) {
      if (def.key === key || def.kind === key) return ch;
    }
    return fallback;
  };

  PlacementAPI.spawnFromAscii = function spawnFromAscii(def, tx, ty, context) {
    if (!def || typeof tx !== 'number' || typeof ty !== 'number') return null;
    const kind = def.kind || def.key;
    const opts = { _ascii: def, tx, ty, context };
    if (def.isSpawn) {
      try { return root.SpawnerManager?.spawnFromDef?.(def, tx, ty, opts); } catch (_) {}
    }
    if (kind === 'wall' || kind === 'void') return null;
    try { return root.Entities?.factory?.(def.factoryKey || kind, opts); } catch (_) {}
    return null;
  };
})(typeof window !== 'undefined' ? window : globalThis);
