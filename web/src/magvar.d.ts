declare module 'magvar' {
  // Declination in degrees (east positive) from the World Magnetic Model 2025; altitude in km.
  export function magvar(latitude: number, longitude: number, altitude?: number, when?: number | Date): number
}
