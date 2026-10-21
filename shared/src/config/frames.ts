import type { Campus } from "./campuses";
import { UIS, UTS } from "./campuses";
import type { GeodeticPoint } from "../math/coords";
import { bearingDeg, distanceMeters, enuRotationMatrix, geodeticToEnu } from "../math/coords";
import type { Mat3 } from "../math/matrix";
import type { Vec3 } from "../math/vec3";
import { norm, scale } from "../math/vec3";

export const ACADEMIC_DISPLACEMENT_NORM = Math.sqrt(20);

export interface RouteFrame {
  readonly origin: Campus;
  readonly destination: Campus;
  readonly originGeodetic: GeodeticPoint;
  readonly destinationGeodetic: GeodeticPoint;
  readonly destinationEnu: Vec3;
  readonly displacement: Vec3;
  readonly distanceMeters: number;
  readonly bearingDeg: number;
  readonly enuRotation: Mat3;
  readonly academicScale: number;
  readonly destinationAcademic: Vec3;
  readonly academicDisplacement: Vec3;
}

const horizontal = (vector: Vec3): Vec3 => [vector[0], vector[1], 0];

export const createRouteFrame = (
  origin: Campus = UTS,
  destination: Campus = UIS,
): RouteFrame => {
  const originGeodetic = origin.geodetic;
  const destinationGeodetic = destination.geodetic;
  const destinationEnu = horizontal(geodeticToEnu(destinationGeodetic, originGeodetic));
  const distance = norm(destinationEnu);
  const academicScale = distance / ACADEMIC_DISPLACEMENT_NORM;
  const destinationAcademic =
    distance > 0
      ? scale(ACADEMIC_DISPLACEMENT_NORM / distance, destinationEnu)
      : ([0, 0, 0] as Vec3);

  return {
    origin,
    destination,
    originGeodetic,
    destinationGeodetic,
    destinationEnu,
    displacement: destinationEnu,
    distanceMeters: distance,
    bearingDeg: bearingDeg(originGeodetic, destinationGeodetic),
    enuRotation: enuRotationMatrix(originGeodetic),
    academicScale,
    destinationAcademic,
    academicDisplacement: destinationAcademic,
  };
};

export const routeFrame = createRouteFrame();

export const toAcademic = (enu: Vec3, frame: RouteFrame = routeFrame): Vec3 =>
  scale(1 / frame.academicScale, enu);

export const fromAcademic = (academic: Vec3, frame: RouteFrame = routeFrame): Vec3 =>
  scale(frame.academicScale, academic);

export const horizontalDistance = (enu: Vec3): number => Math.hypot(enu[0], enu[1]);
