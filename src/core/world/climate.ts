/**
 * Climat statique : latitude, température moyenne annuelle, humidité.
 * Modèle : docs/models.md § Température et § Humidité.
 * Arithmétique autorisée uniquement (+ − × ÷, Math.floor/round) : pas de Math.sin.
 */

import { LAND, OCEAN } from './hydrology.ts';

/**
 * sin(x°) par l'approximation de Bhāskara I (Mahābhāskarīya, VIIe siècle) :
 * sin x° ≈ 4x(180 − x) / (40500 − x(180 − x)) pour x ∈ [0, 180] ; prolongée par
 * imparité et périodicité 360. Erreur absolue max ≈ 0,0016 (mesurée dans les tests).
 */
export function bhaskaraSinDeg(deg: number): number {
  let a = deg - 360 * Math.floor(deg / 360); // [0, 360)
  let sign = 1;
  if (a > 180) {
    a -= 180;
    sign = -1;
  }
  const p = a * (180 - a);
  return (sign * 4 * p) / (40500 - p);
}

/**
 * Latitude (degrés) de la ligne y : linéaire de latNorth (y = 0, en haut) à latSouth
 * (y = H − 1, en bas). Carte d'une seule ligne : latitude moyenne.
 */
export function latitudeOfRow(y: number, height: number, latNorth: number, latSouth: number): number {
  if (height === 1) return (latNorth + latSouth) / 2;
  return latNorth + ((latSouth - latNorth) * y) / (height - 1);
}

export interface TemperatureModel {
  /** Moyenne annuelle globale au niveau de la mer, °C (terme F0). */
  t0: number;
  /** Coefficient du polynôme de Legendre P2, °C (terme F2). */
  t2: number;
  /** Gradient vertical, °C par km (positif : la température baisse avec l'altitude). */
  lapseRatePerKm: number;
}

/**
 * Température moyenne annuelle au niveau de la mer (°C) :
 * T(φ) = T0 + T2·P2(sin φ), P2(x) = (3x² − 1)/2 (North, Cahalan & Coakley 1981, tableau 1).
 */
export function seaLevelTemperature(latDeg: number, m: TemperatureModel): number {
  const x = bhaskaraSinDeg(latDeg);
  return m.t0 + (m.t2 * (3 * x * x - 1)) / 2;
}

/**
 * Couche temperatureMean (centièmes de °C, entiers) :
 * T = round(100·T_mer(φ_ligne)) − round(surface_cm · lapse/1000), surface = waterSurface
 * (terre : élévation ; lac : surface du lac ; océan : 0). Altitudes négatives impossibles ici.
 */
export function computeTemperature(
  waterSurface: Int32Array,
  width: number,
  height: number,
  latNorth: number,
  latSouth: number,
  m: TemperatureModel,
  out: Int16Array,
): void {
  // lapse en centièmes de °C par cm : lapseRatePerKm·100 / 100 000 = lapseRatePerKm / 1000.
  for (let y = 0; y < height; y++) {
    const seaC = Math.round(100 * seaLevelTemperature(latitudeOfRow(y, height, latNorth, latSouth), m));
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const z = waterSurface[row + x]!;
      const t = seaC - Math.round((z * m.lapseRatePerKm) / 1000);
      if (t < -32768 || t > 32767) throw new RangeError(`computeTemperature : ${t} hors de l'intervalle i16`);
      out[row + x] = t;
    }
  }
}

/** Sens du vent dominant : +1 = vent d'ouest (souffle vers l'est, x croissant), −1 = vent d'est. */
export function windDirection(latDeg: number): 1 | -1 {
  const a = latDeg < 0 ? -latDeg : latDeg;
  if (a < 30) return -1; // alizés (vents d'est), cellule de Hadley
  if (a < 60) return 1; // vents d'ouest, cellule de Ferrel
  return -1; // vents d'est polaires, cellule polaire
}

export interface HumidityModel {
  /** Humidité maximale de l'air (entier ; unité arbitraire). */
  moistMax: number;
  /** Recharge au-dessus de l'eau, fraction /65 536 de l'écart à la saturation, par cellule. */
  evap: number;
  /** Précipitation de base sur terre, fraction /65 536 de l'humidité de l'air, par cellule. */
  rainBase: number;
  /** Précipitation orographique : fraction /65 536 ajoutée par mètre de montée vers l'aval du vent. */
  rainOro: number;
  /** Descente maximale de la masse d'air par cellule (cm). */
  airDescent: number;
}

/**
 * Humidité par transport (récurrence exacte en entiers, une ligne à la fois dans le sens du
 * vent de sa bande de latitude). L'air entre par le bord au vent saturé (monde-île entouré
 * d'océan) : humidité de l'air m = moistMax, altitude de la masse d'air a = 0 (cm).
 * Pour chaque cellule c dans le sens du vent, z = surface de c (waterSurface) :
 *  - soulèvement u = max(0, z − a) ; puis a ← max(z, a − airDescent) (la masse d'air suit le
 *    relief vers le haut, ne redescend que de airDescent cm par cellule : une bosse déjà
 *    franchie à une altitude inférieure ne provoque pas de nouvelle pluie orographique) ;
 *  - eau (océan, lac) : m ← m + ⌊(moistMax − m)·evap / 65536⌋ ; humidity = 255 ;
 *  - terre : f = min(65536, rainBase + ⌊rainOro·u / 100⌋) ; p = ⌊m·f / 65536⌋ ; m ← m − p ;
 *    humidity = min(255, ⌊255·p / pRef⌋), pRef = max(1, ⌊moistMax·rainBase / 65536⌋)
 *    (précipitation d'une plaine côtière sous air saturé).
 */
export function computeHumidity(
  water: Uint8Array,
  waterSurface: Int32Array,
  width: number,
  height: number,
  latNorth: number,
  latSouth: number,
  h: HumidityModel,
  out: Uint8Array,
): void {
  const pRefRaw = Math.floor((h.moistMax * h.rainBase) / 65536);
  const pRef = pRefRaw > 1 ? pRefRaw : 1;
  for (let y = 0; y < height; y++) {
    const dir = windDirection(latitudeOfRow(y, height, latNorth, latSouth));
    const row = y * width;
    let m = h.moistMax;
    let a = 0;
    for (let s = 0; s < width; s++) {
      const c = row + (dir === 1 ? s : width - 1 - s);
      const z = waterSurface[c]!;
      const lift = z > a ? z - a : 0;
      const lowered = a - h.airDescent;
      a = z > lowered ? z : lowered;
      if (water[c] !== LAND) {
        m += Math.floor(((h.moistMax - m) * h.evap) / 65536);
        out[c] = 255;
      } else {
        const f0 = h.rainBase + Math.floor((h.rainOro * lift) / 100);
        const f = f0 < 65536 ? f0 : 65536;
        const p = Math.floor((m * f) / 65536);
        m -= p;
        const hv = Math.floor((255 * p) / pRef);
        out[c] = hv < 255 ? hv : 255;
      }
    }
  }
}

/**
 * Mélange méridien (dispersion latérale de l'air humide entre lignes voisines) : moyenne
 * entière des humidités sur la fenêtre verticale [y − r, y + r] (bornée par la carte), appliquée
 * aux seules cellules de terre ; les cellules d'eau restent à 255.
 * hum'[c] = ⌊Σ hum[x, y'] / nombre de lignes⌋. r = 0 : identité.
 */
export function mixHumidityVertically(
  water: Uint8Array,
  humidity: Uint8Array,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius <= 0) return;
  const src = humidity.slice();
  for (let y = 0; y < height; y++) {
    const y0 = y - radius > 0 ? y - radius : 0;
    const y1 = y + radius < height - 1 ? y + radius : height - 1;
    const rows = y1 - y0 + 1;
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      if (water[c] !== LAND) continue;
      let sum = 0;
      for (let yy = y0; yy <= y1; yy++) sum += src[yy * width + x]!;
      humidity[c] = Math.floor(sum / rows);
    }
  }
}

/** Apport local d'eau d'une cellule (unités de débit) : 0 pour l'océan, sinon max(0, humidité − seuil). */
export function localRunoff(water: number, humidity: number, threshold: number): number {
  if (water === OCEAN) return 0;
  const v = humidity - threshold;
  return v > 0 ? v : 0;
}
