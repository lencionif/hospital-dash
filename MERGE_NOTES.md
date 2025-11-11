# Merge Notes: Collision & Ragdoll Effects

This branch integrates the "implementar efectos de colisión y ragdoll" feature work with the latest `main` updates. The following highlights capture the resolved conflicts:

- **index.html** – Added the new `cinefx.plugin.js` script between the logging and physics plugin loads to ensure the cinematic hooks register before physics events fire.
- **CineFX Plugin** – Introduced `assets/plugins/cinefx.plugin.js` providing slow-motion, camera shake, and ragdoll orchestration. The plugin is registered globally as `window.CineFX`.
- **Physics Engine** – Retained main-branch tuning while notifying CineFX about high-impulse impacts and adding the `NPC` mass entry needed for ragdoll impulses.
- **Game Loop** – Prevented AI from controlling entities during ragdoll states and added lifecycle hooks that decay ragdoll timers and restore entity properties after recovery.
- **Puppet Rigs** – Extended rig drawing to handle ragdoll poses (flattened shadows, rotation, scale tweaks) without regressing existing animation states.
- **Placement** – Ensured spawned heroes bind to Puppet rigs immediately so ragdoll visuals activate correctly during gameplay.

The repository no longer contains conflict markers and includes all behaviour from both branches.
