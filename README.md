# Il Divo: Hospital Dash!

## Resumen ejecutivo
**Il Divo: Hospital Dash!** es un arcade top-down frenético ambientado en la planta F7 de Onco-Hematología. El jugador elige entre Enrique, Roberto o Francesco, cada uno con atributos propios, para atender pacientes antes de enfrentarse a los jefes de planta. El bucle central combina entregas de medicación en secuencias exactas, respuesta a timbres telefónicos y gestión de caos hospitalario (carros, guardias, familiares molestos, incendios). Los ascensores, la niebla dinámica, el clima variable y una flecha estilo GTA guían al jugador durante todo el turno. Completar las rondas de pacientes abre la puerta del boss, con tres enfrentamientos temáticos (hipotensión/hipertensión en Hemato, síncope en cafetería y fuego por cigarrillo junto a oxígeno). El HUD monitoriza timbres, entregas, urgencias, puntuación y corazones, mientras que la linterna con Fog of War y los climas día/niebla/tormenta añaden tensión.

## Arquitectura
```
/assets
  /images        ← sprites y arte
  /audio         ← FX y música
/src
  index.html
  style.css
  game.js
  gameflow.api.js
  damage.api.js
  puppet.api.js
  physics.plugin.js
  lighting.plugin.js
  skyweather.plugin.js
  arrowguide.plugin.js
  audio.api.js
  score.api.js
  placement.api.js
  mapgen.plugin.js
  sprites.plugin.js
  /entities
    heroes.entities.js
    patients.entities.js
    doors.entities.js
    elevators.entities.js
    carts.entities.js
    hazards.entities.js
    rat.entities.js
    mosquito.entities.js
```

La lógica del juego reside en `game.js`, que orquesta el loop principal (input → IA → física → sistemas → daño → Puppet). Las entidades encapsulan datos, IA y reglas. Todo el render se canaliza a través de `puppet.api.js`, que sincroniza rigs con el estado físico pero nunca modifica posiciones. `damage.api.js` centraliza los i-frames del jugador y los cooldowns por atacante, eliminando el bug previo de “medio corazón una sola vez”.

## Sistemas destacados
- **PuppetAPI unificado**: héroes, NPCs y enemigos comparten rigs centralizados. Cada entidad se registra al crearse, garantizando coherencia visual.
- **DamageAPI**: gestiona daño por contacto con invulnerabilidad de 1 s, compatible con múltiples atacantes simultáneos.
- **PhysicsAPI**: colisiones AABB simples contra tiles sólidos y otras entidades.
- **Fog & Clima**: `lighting.plugin.js` genera Fog of War con linterna y `skyweather.plugin.js` alterna entre día, niebla y tormenta con destellos.
- **Arrow Guide**: el plugin dibuja una flecha dinámica hacia el paciente pendiente o el boss cuando todos han sido curados.
- **Debug toggles**: `window.SPAWN_DEBUG` permite activar/desactivar categorías de entidades durante QA.

## Ejecución
Abra `src/index.html` en un navegador moderno. Seleccione un héroe y utilice WASD o cursores para moverse (Espacio para interactuar, dígitos 3 y 4 para clima y linterna). El HUD muestra salud, entregas y progreso.

---

Este repositorio contiene un prototipo web listo para servir de base en iteraciones posteriores y compatible con despliegues estáticos.
