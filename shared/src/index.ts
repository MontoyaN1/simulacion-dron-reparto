export type { Vec3 } from "./math/vec3";
export {
  add,
  angleDeg,
  angleRad,
  cross,
  distance,
  dot,
  equalsApprox,
  isParallel,
  isZero,
  negate,
  norm,
  normalize,
  projectOnto,
  rejectFrom,
  scale,
  sub,
  toArray,
  vec3,
} from "./math/vec3";

export type { Mat3, RrefResult } from "./math/matrix";
export {
  columns,
  coordinatesInBasis,
  determinant,
  diag,
  fromColumns,
  frobenius,
  identity,
  imageBasis,
  inverse,
  isInvertible,
  isOrthogonal,
  kernelBasis,
  mat3,
  matrixNorm,
  multiply,
  multiplyVec,
  normOfColumn,
  nullity,
  rank,
  rref,
  trace,
  transpose,
  zeroMatrix,
} from "./math/matrix";

export type { Line3, Plane, Segment3 } from "./math/geometry";
export {
  containsInPlane,
  containsPoint,
  distanceToPlane,
  groundDistance,
  groundProjectionMatrix,
  horizontalPlane,
  lerp,
  line3,
  parameterOf,
  planeFromPointNormal,
  planeFromThreePoints,
  planeNormal,
  planeValue,
  pointAt,
  polylineLength,
  projectOntoPlane,
  projectToGround,
  segmentLength,
  transformLine,
} from "./math/geometry";

export type { GeodeticPoint } from "./math/coords";
export {
  bearingDeg,
  distanceMeters,
  eastNorthUp,
  ecefToEnu,
  ecefToGeodetic,
  enuRotationMatrix,
  enuToEcef,
  enuToGeodetic,
  geodeticToEcef,
  geodeticToEnu,
  horizontalDistanceEnu,
} from "./math/coords";

export type { Campus } from "./config/campuses";
export { CAMPUSES, OPERATION_LIMITS, UIS, UTS } from "./config/campuses";

export type { RouteFrame } from "./config/frames";
export {
  ACADEMIC_DISPLACEMENT_NORM,
  createRouteFrame,
  fromAcademic,
  horizontalDistance,
  routeFrame,
  toAcademic,
} from "./config/frames";
