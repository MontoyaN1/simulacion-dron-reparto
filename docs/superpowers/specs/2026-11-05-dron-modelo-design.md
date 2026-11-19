# Diseño: dron con acabado profesional anime

Fecha: 2026-11-05 · Ronda pedida por el usuario: conservar el diseño general y la composición, pero eliminar el aspecto tosco; hélices fluidas con motion blur ligero y una cámara cinematográfica opcional.

## Intención y alcance

El dron debe leerse como una máquina de reparto cuidada, con geometría limpia, paneles definidos, detalles mecánicos, metales con reflejos estilizados, luces de acento y sombreado por bandas propio de anime. La ciudad sigue siendo Bucaramanga y la simulación conserva su ruta, físicas, telemetría, HUD y escala. No se añade texto, logotipo ni marca de agua al modelo o a la escena 3D.

La cámara cinematográfica se activa y desactiva con `C`. La persecución actual sigue siendo la vista predeterminada, `R` regresa a ella y cualquier interacción de ratón adopta la órbita libre ya existente.

## Restricciones inamovibles

- **48 fps en Intel iGPU**: geometría más densa solo en el dron; una pasada Bloom moderada; nada de motion blur temporal, SSAO, TAA ni postproceso de contornos de pantalla completa.
- **Clean-room**: el generador vive en `scripts/`, fuera de `desktop/`; los assets se hornean antes de compilar. No se añaden dependencias.
- **Contrato GLB**: se conservan `DronReparto`, `Rotor1..4`, `Strobe` y la animación embebida `Rotores` para la web. Se añaden `Estela1..4`. El escritorio sigue animando por código.
- **Compatibilidad visual web**: las estelas nacen con alfa 0 en el GLB; el escritorio les da alfa según el régimen. La web conserva sus rotores animados sin mostrar estelas estáticas.
- **Sin dañar cámaras**: persecución y órbita libre mantienen su comportamiento; la rama cinematográfica reutiliza la colisión con edificios y el límite de altura sobre el terreno.
- **Git**: el usuario prohibió expresamente `git add`, `commit` y `push` en esta ronda. Los documentos quedan en el árbol de trabajo sin commitear.

## Enfoques considerados

### A — Elegido: generador procedural refinado + material toon local + estelas + cámara `C`

Se mejora `scripts/build-drone-model.mjs`, se reemplazan los materiales del dron por un `Material` WGSL con tres bandas de luz y reflejo matcap, y se añaden arcos transparentes ligados al régimen de los rotores. HDR, Bloom y gradación de color dan el tratamiento urbano/anime sin sustituir la ciudad.

A favor: conserva licencias, escala, contrato de nodos y bajo coste; el cel-shading sí ocurre por material y no como simple posterización de la imagen. Coste: un shader propio pequeño y su verificación en el binario real.

### B — Solo `StandardMaterial`, Bloom y más geometría

Es más corto, pero no produce cel-shading real ni permite controlar las bandas y el rim light. Se descarta porque incumple el acabado anime pedido.

### C — Toon, outlines y motion blur por postproceso

Requiere depth/normal prepass, historial temporal y más fills de pantalla; además las estelas temporales producen ghosting con hélices a 14 rev/s. Se descarta por rendimiento, estabilidad entre frames y complejidad.

## Modelo procedural

Convención existente: x derecha, y adelante, z arriba; frente = +y. Se conservan la disposición X, los cuatro motores, el tren, el cardán, el anclaje inferior y el `scale 3.0` del spawn.

1. **Fuselaje**: superelipsoides redondeados, no caja cruda; casco claro y cúpula superior. Segmentación suficiente para normales suaves (32–48 segmentos en cilindros, 32–48 × 16–24 en cuerpos curvos).
2. **Paneles**: tapas finas separadas, juntas oscuras y franja cyan; visor frontal oscuro con dos focos estrechos. Nada de texto.
3. **Mecánica**: brazos carenados con radio variable, campanas de motor tipo píldora, anillos metálicos, tornillería visible y ventilaciones agrupadas. Todo se fusiona por material dentro de `Estructura`.
4. **Tren y carga**: patines refinados con pies redondeados; batería trasera naranja con correas; se conserva el anclaje del paquete.
5. **Aspas**: dos palas taperizadas y con leve flecha, espesor definido, punta cyan y buje metálico. No discos opacos ni geometría deformada.
6. **Luces**: rojo/verde de navegación, focos cyan y `Strobe` blanco; emisivos HDR moderados para Bloom.

## Material anime (`desktop/assets/toon.wgsl`)

`ToonMaterial` conserva por primitivo el color, emisivo, metallic, roughness y alpha del `StandardMaterial` importado. Un sistema usa `GltfMaterialName` para convertir únicamente los materiales del dron; `Estela` permanece como material transparente estándar.

- Diffuse: tres bandas sobre `N·L`, con transiciones antialias mediante `fwidth`; sombras frías y luz cálida.
- Reflejos: matcap procedural de 128×128 generado en Rust, muestreado con la normal en espacio de vista; metallic mezcla el reflejo y roughness reduce su intensidad. Es un reflejo estilizado, no un IBL fotorrealista.
- Definición: rim light cyan discreto; emisivos se suman al final para Bloom.
- No se implementan outlines de pantalla completa ni inverted hull: el rim y las juntas geométricas dan la definición sin artefactos.

## Rotores y motion blur ligero

El giro actual por código se conserva: `min(14, 4.5 + 1.4·v)` rev/s, rampa τ=0.4 s, ejes y direcciones existentes.

Cada rotor recibe un hermano `EstelaN` con dos arcos finos y alfa radial/angular en `COLOR_0`. El nodo gira con el mismo ángulo que `RotorN`. En escritorio:

- `estela_visible(rpm) = rpm >= 1.5`.
- `estela_alfa(rpm) = clamp((rpm - 1.5) / 4, 0, 1) · 0.20`.
- En tierra desaparecen; en despegue surgen gradualmente; en crucero quedan como una estela ligera, no como un disco sólido.

## Cámara cinematográfica adicional

`Camara` añade `cine: bool`. `C` alterna cine/persecución; `R` siempre restaura persecución; ratón o rueda salen a órbita libre como hoy.

El encuadre es frontal three-quarter respecto al corredor: pequeña órbita sinusoidal de ±0.22 rad, distancia entre 8 y 12 m y altura entre aproximadamente 3.5 y 5 m. El zoom heroico lo produce la distancia animada, sin cambiar el FOV de las demás cámaras. La posición se suaviza exponencialmente y pasa por `golpe_de` y la altura mínima del terreno antes de aplicarse.

## Ciudad, luz y color

Se conserva la ortofoto, la malla única de edificios, la atmósfera y las nubes. La dirección urbana/futurista se logra con sol cálido lateral, ambiente frío, saturación moderada (`post_saturation = 1.12`), contraste leve (`1.05`) y Bloom con umbral para que solo luces y brillos altos florezcan. No se añaden rótulos, neones con texto ni una ciudad inventada.

## Verificación

- `scripts/check-drone-model.mjs`: 10 nodos, 4 mallas, nombres `Estela1..4`, 4 canales `Rotores`, materiales y emisivos, `COLOR_0` solo donde corresponde, alfa inicial 0 de estelas, bbox y densidad mínima de geometría.
- Tests Rust puros: alfa/visibilidad de estelas, matcap RGBA, conversión de materiales (incluida exclusión de `Estela`) y encuadre cinematográfico acotado.
- Integración con el GLB real: Rotor1..4 y Estela1..4 giran, el cuerpo no, Strobe parpadea y las estelas cambian de visibilidad/alfa.
- Build release y corrida headless: shader compilado, 0 panics/errores, capturas y promedio cercano a 48 fps. Captura adicional en modo `C`.
- Confirmación visual final del usuario; no se realizan operaciones Git.

## Riesgos

- Un shader custom puede quedar negro o fallar al compilar: se valida en el binario real y se revisan logs/capturas antes de cerrar.
- Demasiado Bloom borra paneles: umbral e intensidad conservadores.
- Transparencias de estelas: arcos pequeños y alfa máximo 0.20 para evitar sorting visible y discos fantasmas.
- La cámara cercana puede tocar fachadas: se reutiliza el raycast y el clamp de suelo; nunca se desactiva la colisión.
