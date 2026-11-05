# Diseño: recorrido reversible (UTS→UIS / UIS→UTS)

## Intención
Un botón en la barra superior ("Sentido: UTS → UIS") que voltea la ruta en
caliente y reinicia el vuelo desde el nuevo origen. Enfoque A (toggle en
caliente), aprobado por el usuario.

## Por qué es barato
Hoy todo el vuelo se deriva de la polilínea de waypoints y es agnóstico al
sentido: el motor persigue waypoints en orden, las fases (despegue/crucero/
descenso/entregado) se clasifican por geometría, la telemetría, la colisión,
la cámara y el terreno no miran el sentido. Lo único direccionado es la
generación de la ruta, la cinta pintada, los colores de los anillos, el
rumbo/destino del panel matemático y dos textos.

## Decisiones
- `perfil_ruta(corredor, invertida: bool)`: mismos puntos de etapa (mismo
  `along` absoluto, luego la S y las etapas de altura son geométricamente
  idénticas), emitidos en orden inverso; extremos cambiados; perfil vertical
  volteado (despegue vertical en el nuevo origen, entrega en el nuevo destino).
- Recurso `Sentido { UtsAUis | UisAuts }` (escena.rs), default UtsAUis.
- Sistema `aplicar_sentido` (Update): detecta cambio con
  `Local<Option<Sentido>>`; al cambiar reconstruye `Vuelo::nuevo(ruta)`
  (precedente: `reiniciar()`), re-inserta la malla de la cinta (marcador
  `CintaRuta`), intercambia colores de anillos (recurso `Zonas { uts, uis }`
  con las entidades; azul = origen, verde = llegada) y actualiza el título de
  la ventana.
- `datos_ruta` (main.rs) deriva rumbo, destino académico y `dir_h` de los
  extremos de `vuelo.ruta` en vez de `corredor.desplazamiento`: al voltear,
  rumbo ≈ +180° y destino académico ≈ (0,0) solos. Caché `Local` claveada por
  los extremos de la ruta (recalcula al cambiar).
- Botón + etiqueta de marca ("DRON · …") leen `Sentido`; el click invierte.
- Anillos: colores intercambiables, posiciones fijas (ya están en ambos
  campus).

## No objetivos
Rutas alternas, múltiples destinos, edición manual de waypoints, cambiar el
marco académico (el origen ENU académico sigue siendo la UTS).

## Riesgos
- Flotantes en la clave de caché: determinismo del cálculo hace que `==`
  funcione (mismos valores bit a bit tras reconstruir).
- Toggle doble rápido: el sistema aplica el último estado; las queries
  (`CintaRuta`, `Zonas`) tienen exactamente un resultado y se protegen con
  `if let`.
