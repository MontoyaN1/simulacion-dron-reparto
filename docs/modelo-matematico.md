# Modelo matemático

Documento de trazabilidad entre la propuesta de Álgebra Lineal y el código de la fase 0.
Cada fórmula tiene su implementación en `shared/src/` y su prueba en `shared/test/`.

## 1. Marcos de coordenadas

| Marco | Unidad | Origen | Uso |
| --- | --- | --- | --- |
| Geodésico WGS84 | grados, metros | elipsoide | datos de los campus |
| ECEF | metros | centro de la Tierra | paso intermedio |
| ENU | metros | UTS | simulación y escena 3D |
| Académico | unidades | UTS | comparación con el documento |

El cambio de ECEF a ENU es una transformación lineal con la matriz de rotación

```
        ⎡ −sin λ            cos λ            0     ⎤
R(φ,λ) = ⎢ −sin φ cos λ     −sin φ sin λ     cos φ  ⎥
        ⎣  cos φ cos λ       cos φ sin λ     sin φ  ⎦
```

y una traslación al origen:

```
x_ENU = R · (x_ECEF − x_UTS)
```

Implementación: `shared/src/math/coords.ts` (`geodeticToEcef`, `enuRotationMatrix`,
`geodeticToEnu`). Pruebas: `shared/test/coords.test.ts`.

Propiedades que el panel mostrará en vivo:

- `det(R) = 1` y `RᵀR = I` ⇒ `R` es ortogonal.
- `ker(R) = {(0, 0, 0)}` e `Im(R) = R³` ⇒ `T(x) = R·x` es un isomorfismo.
- `R⁻¹ = Rᵀ`, por lo que el cambio inverso es exacto y barato.

## 2. Modelo académico del documento

La propuesta original usa `D = (0, 0, 0)` para la UTS y `A = (2, 4, 0)` para la UIS, con
coordenadas simplificadas. Al medir sobre OpenStreetMap, el desplazamiento real es

```
d_ENU = (404.158, 3960.797, 0) m
‖d_ENU‖ = 3981.36 m
rumbo = atan2(404.158, 3960.797) = 5.83°
```

El vector `(2, 4, 0)` implicaría un rumbo de 26.57° y una distancia arbitraria. Para no
deformar la ciudad se conserva la dirección real y se aplica un **escalado uniforme**

```
s = ‖d_ENU‖ / ‖(2, 4, 0)‖ = 3981.36 / √20 = 890.27 m por unidad
d_acad = (1/s) · d_ENU = (0.454, 4.449, 0)
‖d_acad‖ = √20 ≈ 4.4721
```

El escalado es una transformación lineal `T(x) = (1/s)·x` (matriz `diag(1/s, 1/s, 1/s)`), de
rango 3 e invertible. Implementación: `shared/src/config/frames.ts`
(`createRouteFrame`, `toAcademic`, `fromAcademic`).

> Nota para el informe: la coordenada `(2, 4, 0)` era una aproximación preliminar. El modelo
> final conserva la norma `√20` del documento y simultáneamente mantiene el rumbo real medido,
> lo que constituye una mejora del modelo inicial.

## 3. Temas del segundo y tercer corte

| Tema | Fórmula | Implementación | Estado |
| --- | --- | --- | --- |
| Vectores | `d = A − D`, `‖d‖` | `vec3.ts`, `frames.ts` | listo |
| Recta paramétrica y cartesiana | `L(t) = D + t·d` | `geometry.ts` (`line3`, `pointAt`, `containsPoint`) | listo |
| Ecuación del plano | `ax + by + cz = d` | `geometry.ts` (`planeFromPointNormal`, `distanceToPlane`) | listo |
| Producto interno y norma | `cos θ = (v·u)/(‖v‖‖u‖)` | `vec3.ts` (`dot`, `angleDeg`) | listo |
| Proyecciones ortogonales | `P = diag(1, 1, 0)` | `geometry.ts` (`groundProjectionMatrix`, `projectToGround`) | listo |
| Espacios y subespacios | cerrado bajo suma y escalar | — | fase 4 |
| Espacio generado | `span{v₁, v₂, v₃}` | `matrix.ts` (`imageBasis`, `coordinatesInBasis`) | fase 4 |
| Combinaciones lineales | `d = c₁e₁ + c₂e₂ + c₃e₃` | `matrix.ts` (`coordinatesInBasis`) | fase 4 |
| Transformaciones lineales | `T(x) = A·x` | `coords.ts` (`enuRotationMatrix`) | listo |
| Núcleo e imagen | `ker(T)`, `Im(T)` | `matrix.ts` (`kernelBasis`, `imageBasis`, `nullity`) | listo |
| Matriz, rango e isomorfismos | `rango(A)`, `det(A)`, `A⁻¹` | `matrix.ts` (`rank`, `determinant`, `inverse`) | listo |

## 4. Recta de vuelo

Con `D = (0, 0, 0)` y `d = d_acad`:

```
L(t) = t · (0.454, 4.449, 0),  t ∈ [0, 1]
```

Forma cartesiana (componente `z` nula):

```
x / 0.454 = y / 4.449,  z = 0
```

Un punto `P` pertenece a la recta si `(P − D) × d = 0`; la implementación usa el producto
cruz y una tolerancia relativa al tamaño de `d`. El punto medio `t = 0.5` se usa en la prueba
para verificar pertenencia y para descartar puntos fuera de la recta.

## 5. Planos de operación

El techo de vuelo es el plano horizontal

```
0·x + 0·y + 1·z = h,  h = 50 m (AGL de crucero)
```

La distancia de un punto al plano usa producto interno y norma:

```
dist(P, π) = |a x + b y + c z − d| / ‖(a, b, c)‖
```

Con `h = 50`, un dron a 80 m está a 30 m del techo. Las fachadas de edificios se modelan con
planos verticales en la fase 3.

## 6. Proyección al suelo

La sombra y la traza del dron son la proyección ortogonal sobre `z = 0`:

```
      ⎡1 0 0⎤
P  =  ⎢0 1 0⎥ ,   P·p = (x, y, 0)
      ⎣0 0 0⎦
```

Propiedades verificadas en `shared/test/matrix.test.ts`:

- `P² = P` (idempotente).
- `rango(P) = 2`.
- `ker(P) = span{(0, 0, 1)}`, es decir, el eje vertical.
- `Im(P) = {(x, y, 0)}`, el plano del suelo.
- `rango(P) + nulidad(P) = 3` (teorema de la dimensión).

## 7. Verificación

```bash
npm test
```

Las 29 pruebas cubren suma y producto interno, norma y ángulo, proyección y componente
rechazada, determinante e inversa, rango, núcleo e imagen, idempotencia de `P`, ortogonalidad
de `R`, conversión ECEF/ENU ida y vuelta, distancia y rumbo UTS-UIS, y la conservación de la
norma `√20` en el marco académico.
