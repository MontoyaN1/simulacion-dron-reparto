import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearingDeg,
  distanceMeters,
  ecefToGeodetic,
  enuRotationMatrix,
  geodeticToEcef,
  geodeticToEnu,
  horizontalDistanceEnu,
  enuToGeodetic,
} from "../src/math/coords";
import { determinant, isOrthogonal } from "../src/math/matrix";
import { norm, vec3 } from "../src/math/vec3";
import { UIS, UTS } from "../src/config/campuses";
import { createRouteFrame, fromAcademic, toAcademic } from "../src/config/frames";

const frame = createRouteFrame(UTS, UIS);

test("el origen del marco ENU es el vector nulo", () => {
  const enu = geodeticToEnu(UTS.geodetic, UTS.geodetic);
  assert.ok(norm(enu) < 1e-6);
});

test("la matriz de rotacion ENU es ortogonal con determinante 1", () => {
  const rotation = enuRotationMatrix(UTS.geodetic);
  assert.ok(isOrthogonal(rotation));
  assert.ok(Math.abs(determinant(rotation) - 1) < 1e-12);
});

test("UTS a UIS mide aproximadamente 4 km", () => {
  const distance = distanceMeters(UTS.geodetic, UIS.geodetic);
  assert.ok(distance > 3900 && distance < 4100, `distancia inesperada: ${distance}`);
  assert.ok(Math.abs(frame.distanceMeters - distance) < 2);
});

test("el rumbo UTS a UIS apunta al norte con desvio leve al este", () => {
  const bearing = bearingDeg(UTS.geodetic, UIS.geodetic);
  assert.ok(bearing > 4 && bearing < 8, `rumbo inesperado: ${bearing}`);
});

test("el destino en ENU es horizontal y coherente en componentes", () => {
  assert.equal(frame.destinationEnu[2], 0);
  const east = frame.destinationEnu[0];
  const north = frame.destinationEnu[1];
  assert.ok(east > 300 && east < 500, `este inesperado: ${east}`);
  assert.ok(north > 3900 && north < 4060, `norte inesperado: ${north}`);
  assert.ok(Math.abs(horizontalDistanceEnu(frame.destinationEnu) - frame.distanceMeters) < 1e-9);
});

test("conversion ECEF ida y vuelta", () => {
  const original = { latitude: 7.12, longitude: -73.12, altitude: 950 };
  const ecef = geodeticToEcef(original);
  const recovered = ecefToGeodetic(ecef);
  assert.ok(Math.abs(recovered.latitude - original.latitude) < 1e-9);
  assert.ok(Math.abs(recovered.longitude - original.longitude) < 1e-9);
  assert.ok(Math.abs(recovered.altitude - original.altitude) < 1e-6);
});

test("ENU ida y vuelta", () => {
  const enu = vec3(320, -450, 80);
  const geodetic = enuToGeodetic(enu, UTS.geodetic);
  const recovered = geodeticToEnu(geodetic, UTS.geodetic);
  assert.ok(norm(vec3(recovered[0] - enu[0], recovered[1] - enu[1], recovered[2] - enu[2])) < 1e-6);
});

test("el marco academico conserva la norma sqrt(20) del documento", () => {
  assert.ok(Math.abs(norm(frame.destinationAcademic) - Math.sqrt(20)) < 1e-9);
  assert.ok(Math.abs(norm(frame.academicDisplacement) - Math.sqrt(20)) < 1e-9);
  assert.ok(frame.academicScale > 850 && frame.academicScale < 950);
});

test("el cambio de escala es lineal y reversible", () => {
  const a = vec3(10, 20, 0);
  const b = vec3(-4, 8, 0);
  const sumAcademic = toAcademic(vec3(a[0] + b[0], a[1] + b[1], 0));
  const sumSeparate = vec3(
    toAcademic(a)[0] + toAcademic(b)[0],
    toAcademic(a)[1] + toAcademic(b)[1],
    toAcademic(a)[2] + toAcademic(b)[2],
  );
  assert.ok(norm(vec3(sumAcademic[0] - sumSeparate[0], sumAcademic[1] - sumSeparate[1], 0)) < 1e-9);

  const recovered = fromAcademic(toAcademic(a));
  assert.ok(norm(vec3(recovered[0] - a[0], recovered[1] - a[1], 0)) < 1e-9);
});
