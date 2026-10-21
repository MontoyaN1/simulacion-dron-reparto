import type { Mat3 } from "./matrix";
import { mat3, multiplyVec, transpose } from "./matrix";
import type { Vec3 } from "./vec3";
import { add, norm, sub } from "./vec3";

export interface GeodeticPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitude: number;
}

const WGS84_SEMI_MAJOR_AXIS = 6378137;
const WGS84_FLATTENING = 1 / 298.257223563;
const WGS84_ECCENTRICITY_SQUARED = WGS84_FLATTENING * (2 - WGS84_FLATTENING);

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export const geodeticToEcef = (point: GeodeticPoint): Vec3 => {
  const latitude = point.latitude * DEG_TO_RAD;
  const longitude = point.longitude * DEG_TO_RAD;
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinLongitude = Math.sin(longitude);
  const cosLongitude = Math.cos(longitude);

  const primeVerticalRadius =
    WGS84_SEMI_MAJOR_AXIS /
    Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude);

  const x = (primeVerticalRadius + point.altitude) * cosLatitude * cosLongitude;
  const y = (primeVerticalRadius + point.altitude) * cosLatitude * sinLongitude;
  const z =
    (primeVerticalRadius * (1 - WGS84_ECCENTRICITY_SQUARED) + point.altitude) * sinLatitude;

  return [x, y, z];
};

export const enuRotationMatrix = (origin: GeodeticPoint): Mat3 => {
  const latitude = origin.latitude * DEG_TO_RAD;
  const longitude = origin.longitude * DEG_TO_RAD;
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinLongitude = Math.sin(longitude);
  const cosLongitude = Math.cos(longitude);

  return mat3(
    [-sinLongitude, cosLongitude, 0],
    [-sinLatitude * cosLongitude, -sinLatitude * sinLongitude, cosLatitude],
    [cosLatitude * cosLongitude, cosLatitude * sinLongitude, sinLatitude],
  );
};

export const ecefToEnu = (ecef: Vec3, origin: GeodeticPoint): Vec3 =>
  multiplyVec(enuRotationMatrix(origin), sub(ecef, geodeticToEcef(origin)));

export const geodeticToEnu = (point: GeodeticPoint, origin: GeodeticPoint): Vec3 =>
  ecefToEnu(geodeticToEcef(point), origin);

export const enuToEcef = (enu: Vec3, origin: GeodeticPoint): Vec3 =>
  add(geodeticToEcef(origin), multiplyVec(transpose(enuRotationMatrix(origin)), enu));

export const ecefToGeodetic = (ecef: Vec3): GeodeticPoint => {
  const [x, y, z] = ecef;
  const horizontal = Math.hypot(x, y);
  let latitude = Math.atan2(z, horizontal * (1 - WGS84_ECCENTRICITY_SQUARED));

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sinLatitude = Math.sin(latitude);
    const primeVerticalRadius =
      WGS84_SEMI_MAJOR_AXIS /
      Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude);
    const altitude = horizontal / Math.cos(latitude) - primeVerticalRadius;
    const nextLatitude = Math.atan2(
      z,
      horizontal * (1 - ((WGS84_ECCENTRICITY_SQUARED * primeVerticalRadius) / (primeVerticalRadius + altitude))),
    );
    if (Math.abs(nextLatitude - latitude) < 1e-13) {
      latitude = nextLatitude;
      break;
    }
    latitude = nextLatitude;
  }

  const sinLatitude = Math.sin(latitude);
  const primeVerticalRadius =
    WGS84_SEMI_MAJOR_AXIS /
    Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude);
  const altitude = horizontal / Math.cos(latitude) - primeVerticalRadius;

  return {
    latitude: latitude * RAD_TO_DEG,
    longitude: Math.atan2(y, x) * RAD_TO_DEG,
    altitude,
  };
};

export const enuToGeodetic = (enu: Vec3, origin: GeodeticPoint): GeodeticPoint =>
  ecefToGeodetic(enuToEcef(enu, origin));

export const distanceMeters = (from: GeodeticPoint, to: GeodeticPoint): number =>
  norm(geodeticToEnu(to, from));

export const bearingDeg = (from: GeodeticPoint, to: GeodeticPoint): number => {
  const east = geodeticToEnu(to, from)[0];
  const north = geodeticToEnu(to, from)[1];
  return (Math.atan2(east, north) * RAD_TO_DEG + 360) % 360;
};

export const eastNorthUp = (enu: Vec3): { east: number; north: number; up: number } => ({
  east: enu[0],
  north: enu[1],
  up: enu[2],
});

export const horizontalDistanceEnu = (enu: Vec3): number => Math.hypot(enu[0], enu[1]);
