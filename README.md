# Il Divo: Hospital Dash! (prototipo web)

Arcade top-down inspirado en los clásicos de 1983, ambientado en la planta F7 de Onco-Hematología del Hospital La Fe. Juegas como Enrique, Roberto o Francesco: atiende pacientes, lleva medicinas en secuencia, gestiona goteros y evita obstáculos (carros, guardias, ascensores, fuego, etc.).

> Proyecto personal en progreso. Este repo contiene la versión web estática (HTML/CSS/JS) lista para GitHub Pages.

---

## Características destacadas
- **MapGen** con modo ASCII/Debug.
- **Fog of War** + **iluminación dinámica** (cono de linterna del héroe).
- **Clima**: lluvia/tormenta y niebla configurable por nivel.
- **HUD** retro con corazones, timbres, entregas y objetivo activo.
- **Flecha “GTA”** (ArrowGuide) que señala al paciente o boss correcto cuando llevas la pastilla adecuada.
- **Sistemas** dedicados para puertas, ascensores, carros, hazards (fuego/agua), pacientes y puntuación.
- **Música & SFX** listos para enchufar assets.
- **Modo debug** con spawns directos y utilidades de prueba.

---

## Estructura rápida
- `index.html` y `style.css`: raíz del proyecto (HTML estático clásico).
- `assets/images/`: sprites, retratos, fondos y recursos estáticos.
- `assets/plugins/`: todos los scripts (sistemas, APIs y motor Puppet).
  - `assets/plugins/entities/`: factorías de entidades (héroes, ratas, pacientes, etc.).
  - `assets/plugins/puppet.plugin.js`: motor de muñecos.
  - `assets/plugins/puppet.rigs.plugin.js`: rigs de animación para cada entidad.

---

## Atajos de prueba
1. Levanta un servidor local simple (sirve Python 3):
   ```bash
   python3 -m http.server 5173
   ```
2. Abre el navegador en `http://localhost:5173/index.html?map=debug` para cargar el mapa de pruebas con todos los muñecos animados.
3. Activa `?spawn=debug` para forzar apariciones rápidas si necesitas validar IA o colisiones.

### Controles rápidos
- **WASD / Flechas**: mover al héroe.
- **E**: empujar/usar (puertas, carros, ascensores, pacientes).
- **R**: reinicia la partida actual.
- **ESC**: pausa.
- **H** (debug): alterna ayudas y overlays según configuración.

---

## Desarrollo
1. Edita los plugins en `assets/plugins/` respetando el helper `IMG()` para rutas de imágenes (`./assets/images/...`).
2. El orden del loop principal sigue: Input → IA → Física → Sistemas → Daño → Puppet → HUD.
3. El motor de dibujo delega en `PuppetAPI` para todas las entidades animadas.

¡Disfruta explorando el turno más caótico del hospital! 🏥
