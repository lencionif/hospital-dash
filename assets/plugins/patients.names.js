(function (W) {
  'use strict';

  const COMEDIC_NAMES = [
    'Dolores Fuerte de Barriga',
    'Armando Bronca Segura',
    'Susana Oria',
    'Elba Lazo',
    'Aitor Tilla',
    'Elsa Pato',
    'Ester Colero',
    'Elena Nito del Bosque',
    'Luz Cuesta Mogollón',
    'Aída Guapo',
    'Lola Mento',
    'Rosa Melcacho',
    'Marta Chos',
    'Aitor Menta',
    'Aquiles Castro',
    'Dolores Delano',
    'Tomas Turbado',
    'Alan Brito Delgado',
    'Sofía Nía',
    'Benito Camelas',
    'Elsa Kapunta',
    'Ana Lisa Melchoto',
    'Debora Melo',
    'Elsa Porrón',
    'María Nata',
    'Paco Tilla',
    'Rosaura Lio',
    'Natalia Te',
    'Sergio Colate',
    'Tito Livio',
    'Adela Mir',
    'Mónica Galindo',
    'Aurora Ciones',
    'Germán Teca',
    'Lola Flores del Campo',
    'Luz Divina',
    'Carola Linas',
    'César A. Rico',
    'Inés Tabilidad'
  ];

  function toKeyName(displayName) {
    if (!displayName) return 'PACIENTE';
    const norm = displayName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[ªº]/g, '')
      .toUpperCase();
    const word = norm.split(/\s+/).find((w) => w.length >= 4) || norm.split(/\s+/)[0] || 'PACIENTE';
    return word.replace(/[^A-Z]/g, '') || 'PACIENTE';
  }

  function makeAnagram(key, seed = 12345) {
    const arr = String(key || '')
      .replace(/[^A-Z]/gi, '')
      .toUpperCase()
      .split('');
    if (arr.length < 2) return (arr[0] || key || '???');
    let x = seed >>> 0;
    for (let i = arr.length - 1; i > 0; i--) {
      x = (x * 1664525 + 1013904223) >>> 0;
      const j = x % (i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    if (arr.join('') === key) {
      const last = arr.length - 1;
      const tmp = arr[0];
      arr[0] = arr[last];
      arr[last] = tmp;
    }
    return arr.join('');
  }

  function seeded(seed) {
    let x = (seed >>> 0) || 0x9e3779b1;
    return function () {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 0xffffffff;
    };
  }

  function shuffle(source, seed) {
    const rng = seeded(seed);
    for (let i = source.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [source[i], source[j]] = [source[j], source[i]];
    }
    return source;
  }

  const Roster = {
    _pool: [],
    _seed: 0,
    _cursor: 0,
    reset(seed) {
      this._seed = (seed >>> 0) || (Date.now() >>> 0);
      this._pool = shuffle(COMEDIC_NAMES.slice(), this._seed);
      this._cursor = 0;
    },
    ensure(seed) {
      if (!this._pool || this._pool.length === 0) {
        this.reset(seed);
      }
    },
    next(seed) {
      this.ensure(seed);
      if (this._cursor >= this._pool.length) {
        this.reset(this._seed + 17);
      }
      const displayName = this._pool[this._cursor % this._pool.length];
      const idx = this._cursor++;
      const keyName = toKeyName(displayName);
      const anagram = makeAnagram(keyName, (this._seed + idx) >>> 0);
      return {
        displayName,
        keyName,
        anagram,
        nameTagYOffset: 18,
        seed: this._seed,
        index: idx
      };
    }
  };

  function assignPatients(levelSeed, count) {
    const safeCount = Math.max(0, Math.min(35, count | 0));
    Roster.reset(levelSeed >>> 0);
    const out = [];
    for (let i = 0; i < safeCount; i++) {
      out.push(Roster.next());
    }
    return out;
  }

  const API = {
    COMEDIC_NAMES: COMEDIC_NAMES.slice(),
    toKeyName,
    makeAnagram,
    assignPatients,
    reset(seed) {
      Roster.reset(seed >>> 0);
    },
    next(seed) {
      return Roster.next(seed >>> 0);
    }
  };

  W.PatientNames = API;
})(this);
