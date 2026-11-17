#import bevy_pbr::{
    forward_io::{VertexOutput, FragmentOutput},
    mesh_view_bindings::{view, lights},
}

struct ToonUniform {
    color: vec4<f32>,
    emissive: vec4<f32>,
    // x = metallic, y = roughness, z = unlit.
    params: vec4<f32>,
}

@group(2) @binding(0) var<uniform> material: ToonUniform;
@group(2) @binding(1) var matcap_textura: texture_2d<f32>;
@group(2) @binding(2) var matcap_muestreador: sampler;

@fragment
fn fragment(in: VertexOutput) -> FragmentOutput {
    let n = normalize(in.world_normal);
    let v = normalize(view.world_position - in.world_position.xyz);
    let luz = lights.directional_lights[0];
    let l = normalize(luz.direction_to_light);

    // Tres bandas con transición de un píxel: bordes anime sin escalones
    // dentados al orbitar la cámara o cambiar la distancia.
    let ndl = max(dot(n, l), 0.0);
    let aa = max(fwidth(ndl) * 0.55, 0.004);
    let media = smoothstep(0.24 - aa, 0.24 + aa, ndl);
    let alta = smoothstep(0.62 - aa, 0.62 + aa, ndl);
    let banda = 0.30 + 0.34 * media + 0.36 * alta;

    // La luz de Bevy viene premultiplicada por iluminancia. Normalizamos su
    // color para conservar el tinte sin volver a escalarlo por miles.
    let lc = luz.color.rgb;
    let tinte = lc / max(max(lc.r, lc.g), max(lc.b, 0.0001));
    let base = material.color.rgb;
    let sombra_fria = vec3<f32>(0.20, 0.27, 0.42);
    var color = base * (sombra_fria + banda * tinte * 0.82);

    // Metal estilizado: matcap en espacio de vista. Roughness reduce el
    // reflejo, pero incluso la carcasa conserva una respuesta especular leve.
    let normal_vista = normalize((view.view_from_world * vec4<f32>(n, 0.0)).xyz);
    let matcap_uv = vec2<f32>(normal_vista.x, -normal_vista.y) * 0.5 + vec2<f32>(0.5);
    let reflejo = textureSample(matcap_textura, matcap_muestreador, matcap_uv).rgb;
    let metallic = material.params.x;
    let roughness = material.params.y;
    let peso_metal = metallic * (1.0 - roughness * 0.55) * 0.72;
    color = mix(color, reflejo * (0.65 + 0.45 * banda), peso_metal);

    // Rim cyan discreto: separa la silueta del fondo urbano sin outlines de
    // pantalla completa ni inverted hull.
    let rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    let rim_banda = smoothstep(0.42, 0.62, rim);
    color += vec3<f32>(0.02, 0.28, 0.48) * rim_banda * 0.45;

    color = mix(color, base, material.params.z);
    color += material.emissive.rgb;

    var out: FragmentOutput;
    out.color = vec4<f32>(color, material.color.a);
    return out;
}
