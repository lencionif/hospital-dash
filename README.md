# Hospital Dash (debug build)

Refactor del primer commit para ejecutar el mapa de depuración con la arquitectura de plugins. Todo el código JavaScript vive en `./assets/plugins/` (con las entidades en `./assets/plugins/entities/`) y las imágenes se cargan exclusivamente desde `./assets/images/`.

## Ejecutar
1. Lanza un servidor estático en la raíz del proyecto (por ejemplo `npx serve .` o `python3 -m http.server`).
2. Abre `http://localhost:8000/index.html` (ajusta el puerto según tu servidor).

> La ejecución directa con `file://` puede bloquear algunas APIs del navegador (audio), por eso se recomienda usar un servidor.

## Controles
- **WASD / Cursores**: mover al héroe.
- **E o Espacio**: recoger píldoras y atender pacientes.
- **ESC**: pausa/continuar.
- **R**: reiniciar la partida actual.

## Objetivo del mapa debug
1. Recoge la píldora correcta.
2. Atiende al único paciente.
3. La puerta de emergencia se abre automáticamente.
4. Empuja el carro de urgencias hasta el jefe para ganar.

Durante el contacto continuo con ratas, mosquitos o hazards pierdes medio corazón cada segundo (con invulnerabilidad de 1 s tras cada golpe). Los carros se resuelven con física separada por ejes y deslizamiento para que no se queden atascados en esquinas.

## Debug rápido
`window.SPAWN_DEBUG` está disponible en consola. Cambia cualquier flag a `false` y reinicia con **R** para aislar una familia de entidades:

```
SPAWN_DEBUG.RAT = false;
SPAWN_DEBUG.MOSQUITO = false;
```

Claves disponibles: `HERO`, `PATIENT`, `RAT`, `MOSQUITO`, `CART`, `DOOR`, `ELEVATOR`, `HAZARD`, `BOSS`, `PILL`.

## Arquitectura
- `assets/plugins/physics.plugin.js`: colisiones AABB con resolución separada por ejes y empuje de carros.
- `assets/plugins/puppet.plugin.js`: único motor de renderizado (rigs `biped`, `rat`, `mosquito`, `sprite`).
- `assets/plugins/damage.plugin.js`: daño con cooldown por atacante e invulnerabilidad del jugador.
- `assets/plugins/gameflow.plugin.js`: controla la puerta de emergencia, seguimiento de pacientes y condición de victoria.
- `assets/plugins/placement.plugin.js`: pobla el mapa generado en `assets/plugins/mapgen.plugin.js` respetando el orden de spawns (el primer carro siempre es el de urgencias).
- `assets/plugins/sprites.plugin.js`: carga y dibuja sprites desde `./assets/images/`.
- `assets/plugins/entities/*.entities.js`: define héroes, pacientes, enemigos, puertas, ascensores, carros y hazards, todos vinculados al motor Puppet.
- `assets/plugins/game.js`: orquesta el bucle (input → IA → física → sistemas → daño → render → HUD).

El audio se sirve desde `./assets/audio/` y los estilos viven en `style.css`. El proyecto funciona en cualquier navegador moderno sin dependencias externas.
