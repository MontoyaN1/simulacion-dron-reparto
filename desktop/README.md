# Simulación UTS → UIS (Bevy nativo)

Cliente de escritorio autónomo: el motor de vuelo, la planificación A* y la
escena corren en Rust con Bevy; cero dependencias de node, web o servidor.

## Requisitos

- Rust estable (cargo/rustc en PATH)

## Ejecución

```bash
cd desktop
cargo run --release
```

## Notas

- El terreno usa `assets/corredor-satelital.jpg` (ortofoto horneada del corredor).
- Los edificios se generan desde `assets/edificios.geojson` + `assets/alturas-edificios.json`.
- La cámara y las unidades de alturas son relativas al ancla (938.5 msnm).
