(() => {
  'use strict';

  const attachments = [];
  const lookup = new WeakMap();
  const rigs = new Map();

  function sortByZ() {
    attachments.sort((a, b) => a.config.z - b.config.z);
  }

  function baseSpriteDraw(ctx, camera, puppet, spriteName) {
    const { entity, config, state } = puppet;
    const { scale = 1 } = config;
    const imgName = spriteName || config.skin;
    if (!imgName) return;

    const screenX = (entity.x - camera.x) * camera.zoom + camera.w * 0.5;
    const screenY = (entity.y - camera.y) * camera.zoom + camera.h * 0.5;

    Sprites.draw(ctx, imgName, screenX, screenY, {
      scale: camera.zoom * scale,
      rotation: state.rotation || 0,
      flipX: state.flipX || false,
      flipY: state.flipY || false,
      opacity: config.opacity ?? 1,
      anchorX: 0.5,
      anchorY: 0.5
    });
  }

  function defaultRigFactory() {
    return {
      update(dt, puppet) {
        const { entity, state } = puppet;
        const speed = Math.hypot(entity.vx || 0, entity.vy || 0);
        state.step = (state.step || 0) + speed * dt * 0.02;
        if (speed > 0.1) {
          state.rotation = Math.sin(state.step * 6) * 0.08;
          state.flipX = (entity.facing || 1) < 0;
        } else {
          state.rotation = 0;
        }
      },
      draw(ctx, camera, puppet) {
        baseSpriteDraw(ctx, camera, puppet);
      }
    };
  }

  function createBipedRig() {
    return {
      update(dt, puppet) {
        const { entity, config, state } = puppet;
        const speed = Math.hypot(entity.vx || 0, entity.vy || 0);
        state.walk = (state.walk || 0) + speed * dt * 0.08;
        state.swing = Math.sin(state.walk * 12) * Math.min(speed / 120, 1);
        state.flipX = entity.dirX < 0;
        state.rotation = state.swing * 0.15;
      },
      draw(ctx, camera, puppet) {
        const { entity, config, state } = puppet;
        const screenX = (entity.x - camera.x) * camera.zoom + camera.w * 0.5;
        const screenY = (entity.y - camera.y) * camera.zoom + camera.h * 0.5;
        Sprites.draw(ctx, config.skin, screenX, screenY, {
          scale: camera.zoom * (config.scale || 1),
          rotation: state.rotation || 0,
          flipX: state.flipX || false,
          anchorX: 0.5,
          anchorY: 0.5
        });
      }
    };
  }

  function createRatRig() {
    return {
      update(dt, puppet) {
        const { entity, state } = puppet;
        state.time = (state.time || 0) + dt;
        state.tailAngle = Math.sin(state.time * 10) * 0.4;
        state.flipX = entity.dirX < 0;
      },
      draw(ctx, camera, puppet) {
        const { entity, config, state } = puppet;
        const screenX = (entity.x - camera.x) * camera.zoom + camera.w * 0.5;
        const screenY = (entity.y - camera.y) * camera.zoom + camera.h * 0.5;
        const scale = camera.zoom * (config.scale || 1);

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.scale(state.flipX ? -scale : scale, scale);
        ctx.fillStyle = 'rgba(80, 62, 40, 0.85)';
        ctx.beginPath();
        ctx.ellipse(-10, -4, 6, 3, state.tailAngle || 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        Sprites.draw(ctx, config.skin, screenX, screenY, {
          scale,
          flipX: state.flipX,
          anchorX: 0.5,
          anchorY: 0.5
        });
      }
    };
  }

  function createMosquitoRig() {
    return {
      update(dt, puppet) {
        const { state, entity } = puppet;
        state.time = (state.time || 0) + dt;
        state.wing = Math.sin(state.time * 20) * 0.6;
        state.flipX = entity.dirX < 0;
      },
      draw(ctx, camera, puppet) {
        const { entity, config, state } = puppet;
        const screenX = (entity.x - camera.x) * camera.zoom + camera.w * 0.5;
        const screenY = (entity.y - camera.y) * camera.zoom + camera.h * 0.5;
        const scale = camera.zoom * (config.scale || 1);

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.scale(scale, scale);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#d0e8ff';
        ctx.beginPath();
        ctx.rotate(state.wing || 0);
        ctx.ellipse(-12, 0, 10, 4, 0, 0, Math.PI * 2);
        ctx.ellipse(12, 0, 10, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        Sprites.draw(ctx, config.skin, screenX, screenY, {
          scale,
          flipX: state.flipX,
          anchorX: 0.5,
          anchorY: 0.5
        });
      }
    };
  }

  function createAttachment(entity, config) {
    const rigFactory = rigs.get(config.rig) || defaultRigFactory;
    const rig = rigFactory(entity, config) || rigFactory();
    const puppet = {
      entity,
      config,
      state: {},
      update: (dt) => rig.update?.(dt, puppet),
      draw: (ctx, camera) => rig.draw?.(ctx, camera, puppet)
    };
    return puppet;
  }

  const PuppetAPI = {
    registerRig(name, factory) {
      if (!name || typeof factory !== 'function') return;
      rigs.set(name, factory);
    },
    attach(entity, options = {}) {
      if (!entity) return null;
      if (lookup.has(entity)) {
        this.detach(entity);
      }
      const config = Object.assign({
        rig: 'sprite',
        skin: null,
        z: 0,
        scale: 1,
        opacity: 1
      }, options);
      if (!config.skin && config.rig === 'sprite') {
        console.warn('Puppet rig needs a skin', entity);
      }
      const puppet = createAttachment(entity, config);
      attachments.push(puppet);
      lookup.set(entity, puppet);
      sortByZ();
      return puppet;
    },
    detach(entity) {
      const puppet = lookup.get(entity);
      if (!puppet) return;
      const idx = attachments.indexOf(puppet);
      if (idx >= 0) attachments.splice(idx, 1);
      lookup.delete(entity);
    },
    update(dt) {
      attachments.forEach((puppet) => puppet.update?.(dt));
    },
    draw(ctx, camera) {
      attachments.forEach((puppet) => puppet.draw?.(ctx, camera));
    }
  };

  window.PuppetAPI = PuppetAPI;

  PuppetAPI.registerRig('sprite', () => defaultRigFactory());
  PuppetAPI.registerRig('biped', () => createBipedRig());
  PuppetAPI.registerRig('rat', () => createRatRig());
  PuppetAPI.registerRig('mosquito', () => createMosquitoRig());
})();
