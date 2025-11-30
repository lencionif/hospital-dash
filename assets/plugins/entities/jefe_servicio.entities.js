// Carro de comidas (cart_food_pinball)
function createCartFood(x, y) {
  return Entities.createGameEntity({
    kind: ENT.CART_FOOD,
    x, y,
    populationType: 'carts',
    group: 'carts',
    rig: 'cart_food_pinball',
    solid: true,
    health: 4,
    touchDamage: 1,          // corazones
    physics: {
      mass        : 1.0,
      maxSpeed    : 140,
      restitution : 0.9,
      fireThreshold   : 180,
      squashThreshold : 2.0,
    },
  });
}

// Puerta normal
function createDoorNormal(x, y) {
  const e = Entities.createGameEntity({
    kind: ENT.DOOR_NORMAL,
    x, y,
    populationType: 'none',
    group: 'doors',
    rig: 'door_hospital',
    solid: true,
    isTileWalkable: false,
    health: 3,
    fireImmune: false,
  });

  e.onInteract = function onDoorInteract(actor) {
    // abrir/cerrar puerta sin condición de pacientes
    DoorsAPI && DoorsAPI.toggle && DoorsAPI.toggle(e, actor);
  };

  return e;
}