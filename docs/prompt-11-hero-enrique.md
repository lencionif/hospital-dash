# Prompt 11 · S — Héroe Principal (Jugador)

**Personaje:** Enrique, enfermero heroico controlado por el jugador. Valiente y decidido, de aspecto tierno y ligeramente cómico. Lleva uniforme sanitario y un maletín o herramienta médica. Animaciones fluidas y expresivas: determinación en acción, humanidad en reposo.

## Reglas generales de animación
- Estilo cartoon con proporciones simpáticas.
- Uniforme sanitario, cofia o peinado reconocible desde todos los ángulos.
- Maletín o herramienta médica visible cuando corresponda.
- Movimientos con sensación de peso (bounce suave) y expresión concentrada.
- Las animaciones de interacción regresan a `idle` al finalizar.

## Ciclos de movimiento
### Caminata lateral (4 frames)
1. Frame A: Pierna derecha adelante, izquierda atrás; brazo derecho atrás, izquierdo adelante; cuerpo inclinado levemente hacia la marcha.
2. Frame B: Paso intermedio, pies alineados bajo el torso; brazos cruzando; ligero bounce hacia arriba.
3. Frame C: Inversión de Frame A (pierna izquierda adelante). Expresión concentrada.
4. Frame D: Paso intermedio inverso para cerrar el ciclo. Mantener continuidad horizontal y oscilación vertical sutil.

### Caminata hacia arriba (4 frames)
- Perspectiva trasera mostrando nuca y espalda.
- Brazos alternando hacia atrás con codos visibles.
- Piernas discernibles bajo la bata, marcando el paso.
- Cofia/pelo estable, ligero rebote del torso.

### Caminata hacia abajo (4 frames)
- Perspectiva frontal mirando al jugador.
- Rodillas elevándose, pies visibles al frente.
- Brazos pendulando alternadamente delante/detrás.
- Rostro con expresión neutra o enfocada.

### Idle / respiración (4 frames)
- Vista frontal o ¾.
- Pecho sube/baja suavemente; hombros acompañan.
- Cabeza inclina levemente con el ritmo.
- Opcional: dedos relajándose o parpadeo puntual.

## Estados especiales
### Muerte por aplastamiento (2–3 frames)
1. Normal de pie.
2. Transición instantánea a cuerpo aplastado tipo cartoon: torso achatado, extremidades extendidas, ojos en espiral.
3. (Opcional) Frame final estático en el suelo.

### Muerte por daño físico (3–4 frames)
1. Impacto final: se arquea hacia atrás con brazos abiertos.
2. Cae de rodillas, cabeza ladeada.
3. Se desploma boca arriba o de lado, brazos extendidos, ojos cerrados.
4. (Opcional) Cese total de movimiento.

### Muerte por fuego (4+ frames)
1. Llamas aparecen en piernas, brazos agitados en pánico.
2. Fuego asciende al torso; pasos descontrolados.
3. Colapso a rodillas, sigue ardiendo.
4. Cae al suelo (boca abajo o arriba) ennegrecido con humo residual.

## Interacciones y acciones
### Hablar (loop de 2–3 frames)
- Pose amigable: mano levantada señalando o gesticulando.
- Boca alterna entre abierta/cerrada; cabeza se inclina levemente.
- Repite hasta cerrar diálogo, luego vuelve a `idle`.

### Comer / curarse (3–4 frames)
1. Enrique acerca ítem (píldora o snack) a la boca.
2. Objeto desaparece; mandíbula mastica o traga (mejillas infladas opcionales).
3. Sonrisa leve o suspiro de alivio.

### Tomar power-up (3 frames + sostén)
1. Se agacha a recoger.
2. Se incorpora alzando el power-up sobre la cabeza, brazos extendidos, mirada hacia arriba.
3. Mantiene pose victoriosa con brillo del objeto antes de volver a `idle`.

### Acción contextual (3 frames)
- Posición de empuje lateral: pies firmes, manos contra objeto, cuerpo inclinado.
- Movimiento de esfuerzo (rodillas y codos flexionan). Puede mostrar gota de sudor.
- Incluye variante de accionar interruptor: brazo se extiende para pulsar botón con mirada enfocada.

### Ataque cuerpo a cuerpo (3 frames)
1. Carga: puño (o maletín) hacia atrás, torso girado.
2. Golpe: brazo extendido con efecto de velocidad.
3. Recuperación: brazo vuelve a posición neutral.

## Extras sugeridos
- Animación de victoria: levanta ambos brazos y da pequeño salto celebratorio.
- Reacción rápida al recibir daño: se encoge y se lleva una mano al impacto antes de retomar la acción.
- Uso de puertas y ascensores reutiliza animación de acción + efectos del entorno.

> Estas guías cubren el rango completo de acciones del protagonista para mantener coherencia y expresividad en todo el juego.
