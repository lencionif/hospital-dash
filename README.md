# Il Divo: Hospital Dash! (prototipo web)

Arcade top-down inspirado en los clásicos de 1983, ambientado en la planta F7 de Onco-Hematología del Hospital La Fe. Juegas como Enrique, Roberto o Francesco: atiende pacientes, lleva medicinas en secuencia, gestiona goteros y evita obstáculos (carros, guardias, ascensores, fuego, etc.).

> Proyecto personal en progreso. Este repo contiene la versión web estática (HTML/CSS/JS) lista para GitHub Pages.

---

## Características (actuales)
- **MapGen** con modo ASCII/Debug.
- **Fog of War** + **iluminación** (cono de linterna del héroe).
- **Clima**: lluvia/tormenta, niebla configurable por nivel.
- **HUD** con corazones, timbres, entregas, objetivo.
- **Flecha “GTA”** (plugin) que apunta a paciente/boss cuando llevas la pastilla adecuada.
- **Sistemas**: Puertas/Ascensores/Carros/Hazards (fuego)/Pacientes/Guardia/Score.
- **Música & SFX** (API preparada para integrar assets).
- **Controles debug** (ver debajo).

---

## Estructura de carpetas (sugerida)

```
/ (repo root)
├─ index.html
├─ style.css
└─ assets/
   ├─ images/
   ├─ audio/
   └─ plugins/
      ├─ *.plugin.js
      └─ entities/*.entities.js
```

## Cómo probar en local

1. Desde la raíz del repositorio ejecuta:

   ```bash
   python3 -m http.server 5173
   ```

2. Abre [http://localhost:5173/index.html?map=debug](http://localhost:5173/index.html?map=debug) para cargar el mapa de pruebas con puertas, pacientes y enemigos.

El parámetro `map=debug` activa el flujo de victoria completo: entrega la pastilla correcta, observa cómo desaparece el paciente, la puerta del boss se abre y empuja el carro de urgencias hasta él para terminar la partida.

---

## Leyenda ASCII rápida

- `d`: puerta normal.
- `u`: puerta de urgencias / boss (se abre al atender a todos los pacientes).

### Pruebas rápidas (internas)

- `index.html?map=debug` carga `assets/config/debug-map.txt`, genera héroe/boss/NPCs desde ASCII y muestra logs de spawn únicos.
- `index.html?map=debug;nivel=1/2/3` reutiliza el mapa de debug pero cambia el boss según el nivel.
- `index.html` sin parámetros usa `level_rules.xml` + `mapgen.plugin.js` para generar el hospital procedural y pasar por el mismo pipeline de colocación.
