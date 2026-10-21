import type { GeodeticPoint } from "../math/coords";

export interface Campus {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly city: string;
  readonly role: "despacho" | "entrega";
  readonly geodetic: GeodeticPoint;
  readonly source: string;
}

export const UTS: Campus = {
  id: "UTS",
  name: "Unidades Tecnológicas de Santander",
  shortName: "UTS",
  city: "Bucaramanga, Santander, Colombia",
  role: "despacho",
  geodetic: {
    latitude: 7.1051164,
    longitude: -73.123524,
    altitude: 0,
  },
  source: "OpenStreetMap way/240015108",
};

export const UIS: Campus = {
  id: "UIS",
  name: "Universidad Industrial de Santander",
  shortName: "UIS",
  city: "Bucaramanga, Santander, Colombia",
  role: "entrega",
  geodetic: {
    latitude: 7.1409311,
    longitude: -73.1198652,
    altitude: 0,
  },
  source: "OpenStreetMap way/312645690",
};

export const CAMPUSES: readonly Campus[] = [UTS, UIS];

export const OPERATION_LIMITS = {
  cruiseAltitudeAglMeters: 50,
  maxAltitudeAglMeters: 120,
  minimumBatteryReservePercent: 20,
  cruiseSpeedMetersPerSecond: 15,
} as const;
