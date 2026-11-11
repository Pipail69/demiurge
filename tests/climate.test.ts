/**
 * Climat : Bhāskara, latitude, température, vents, humidité (docs/models.md).
 */
import { describe, expect, it } from 'vitest';
import {
  bhaskaraSinDeg, computeHumidity, computeTemperature, latitudeOfRow, localRunoff, mixHumidityVertically,
  seaLevelTemperature, windDirection, type HumidityModel,
} from '../src/core/world/climate.ts';
import { DEFAULT_WORLDGEN_PARAMS as D } from '../src/core/world/params.ts';

const TEMP = { t0: D.seaLevelT0C, t2: D.seaLevelT2C, lapseRatePerKm: D.lapseRateCPerKm };
const HUM: HumidityModel = { moistMax: D.moistMax, evap: D.evapRef, rainBase: D.rainBaseRef, rainOro: D.rainOro, airDescent: D.airDescentCm };

describe('Approximation de Bhāskara I', () => {
  it('erreur absolue max < 0,0017 contre Math.sin sur [0°, 360°] (pas 0,001°), valeurs exactes en 0, 30, 90, 180', () => {
    let maxErr = 0;
    let at = 0;
    for (let i = 0; i <= 360_000; i++) {
      const d = i / 1000;
      const e = Math.abs(bhaskaraSinDeg(d) - Math.sin((d * Math.PI) / 180));
      if (e > maxErr) {
        maxErr = e;
        at = d;
      }
    }
    console.log(`[bhaskara] erreur absolue max ${maxErr.toFixed(6)} à ${at}°`);
    expect(maxErr).toBeLessThan(0.0017);
    expect(maxErr).toBeGreaterThan(0.001); // c'est bien l'approximation, pas Math.sin
    expect(bhaskaraSinDeg(0)).toBe(0);
    expect(bhaskaraSinDeg(30)).toBe(0.5); // 4·30·150/(40500 − 4500) = 18000/36000
    expect(bhaskaraSinDeg(90)).toBe(1);
    expect(bhaskaraSinDeg(180)).toBe(0);
    expect(bhaskaraSinDeg(270)).toBe(-1);
    expect(bhaskaraSinDeg(-90)).toBe(-1);
    expect(bhaskaraSinDeg(450)).toBe(1);
  });
});

describe('Latitude et température', () => {
  it('latitude linéaire : ligne 0 = latNorth, dernière ligne = latSouth', () => {
    expect(latitudeOfRow(0, 101, 66, 0)).toBe(66);
    expect(latitudeOfRow(100, 101, 66, 0)).toBe(0);
    expect(latitudeOfRow(50, 101, 66, 0)).toBe(33);
    expect(latitudeOfRow(0, 1, 60, 20)).toBe(40);
  });

  it('niveau de la mer : T0 + T2·P2(sin φ) (North et al. 1981) ; 28,9 °C à l\'équateur, −13,1 °C au pôle', () => {
    expect(seaLevelTemperature(0, TEMP)).toBeCloseTo(14.9 + 14, 10);
    expect(seaLevelTemperature(90, TEMP)).toBeCloseTo(14.9 - 28, 10);
    // P2(sin 30°) = (3/4 − 1)/2 = −1/8 → 14,9 + 3,5
    expect(seaLevelTemperature(30, TEMP)).toBeCloseTo(18.4, 10);
  });

  it('niveau de la mer : strictement décroissante du sud (équateur) vers le nord (pôle)', () => {
    let prev = Infinity;
    for (let lat = 0; lat <= 90; lat += 0.25) {
      const t = seaLevelTemperature(lat, TEMP);
      if (lat > 0) expect(t).toBeLessThan(prev);
      prev = t;
    }
  });

  it('gradient vertical EXACT : même ligne, 1 000 m plus haut → 6,50 °C plus froid ; formule entière', () => {
    const W = 4;
    const H = 3;
    const z = Int32Array.from([0, 100_000, 250_000, 12_345, 0, 100_000, 250_000, 12_345, 0, 100_000, 250_000, 12_345]);
    const out = new Int16Array(12);
    computeTemperature(z, W, H, 60, 10, TEMP, out);
    for (let y = 0; y < H; y++) {
      const sea = Math.round(100 * seaLevelTemperature(latitudeOfRow(y, H, 60, 10), TEMP));
      expect(out[y * W]).toBe(sea);
      expect(out[y * W]! - out[y * W + 1]!).toBe(650);
      expect(out[y * W]! - out[y * W + 2]!).toBe(1625);
      expect(out[y * W + 3]).toBe(sea - Math.round((12_345 * 6.5) / 1000)); // 80,24 → 80
      if (y > 0) expect(out[y * W]).toBeGreaterThan(out[(y - 1) * W]!); // plus chaud vers le sud
    }
  });
});

describe('Vents dominants (circulation à trois cellules)', () => {
  it('alizés d\'est < 30°, vents d\'ouest 30–60°, vents d\'est polaires ≥ 60°', () => {
    expect(windDirection(0)).toBe(-1);
    expect(windDirection(29.9)).toBe(-1);
    expect(windDirection(30)).toBe(1);
    expect(windDirection(59.9)).toBe(1);
    expect(windDirection(60)).toBe(-1);
    expect(windDirection(90)).toBe(-1);
  });

  it('humidité : décroît dans le sens du vent de CHAQUE bande (terre plate, air saturé au bord au vent)', () => {
    const W = 60;
    const H = 3; // lignes à 75° (polaire, d'est), 45° (d'ouest), 15° (alizés, d'est)
    const water = new Uint8Array(W * H); // tout terre
    const z = new Int32Array(W * H).fill(1000);
    const out = new Uint8Array(W * H);
    computeHumidity(water, z, W, H, 75, 15, { ...HUM, rainBase: 3000 }, out);
    const row = (y: number) => Array.from(out.subarray(y * W, (y + 1) * W));
    for (const [y, dir] of [[0, -1], [1, 1], [2, -1]] as const) {
      const r = row(y);
      const along = dir === 1 ? r : [...r].reverse();
      for (let i = 1; i < W; i++) expect(along[i], `ligne ${y}, pas ${i}`).toBeLessThanOrEqual(along[i - 1]!);
      expect(along[0]).toBeGreaterThan(along[W - 1]! + 50); // décroissance réelle
    }
  });
});

describe('Humidité : cas de référence 1D construit à la main', () => {
  // Une ligne à 45° (vents d'ouest, de gauche à droite) : océan, plaine, montagne, plaine.
  const W = 70;
  const water = new Uint8Array(W);
  const z = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    if (x < 10) {
      water[x] = 1;
      z[x] = 0;
    } else if (x < 30) z[x] = 5_000; // plaine à 50 m
    else if (x < 40) z[x] = 5_000 + (x - 29) * 30_000; // versant au vent : +300 m par cellule
    else if (x < 50) z[x] = 5_000 + (50 - x) * 30_000; // versant sous le vent
    else z[x] = 5_000; // plaine sous le vent
  }
  const out = new Uint8Array(W);
  computeHumidity(water, z, W, 1, 45, 45, HUM, out);

  it('eau = 255 ; plaine côtière saturée = 255 ; décroissance vers l\'intérieur', () => {
    for (let x = 0; x < 10; x++) expect(out[x]).toBe(255);
    expect(out[10]).toBe(255);
    for (let x = 11; x < 30; x++) expect(out[x]).toBeLessThanOrEqual(out[x - 1]!);
    expect(out[29]).toBeLessThan(out[10]!);
  });

  it('pluie orographique sur le versant au vent, chute brutale derrière la montagne (ombre pluviométrique)', () => {
    const plainBefore = out[29]!;
    for (let x = 30; x < 40; x++) expect(out[x]).toBeGreaterThan(plainBefore); // versant au vent arrosé
    for (let x = 40; x < W; x++) expect(out[x]).toBeLessThan(plainBefore / 2); // ombre
    console.log(`[humidité 1D] plaine avant ${plainBefore}, crête ${out[39]}, plaine après ${out[55]}`);
  });

  it('même ligne sans montagne : pas d\'ombre (contrôle)', () => {
    const flat = new Int32Array(W).fill(5_000);
    for (let x = 0; x < 10; x++) flat[x] = 0;
    const o2 = new Uint8Array(W);
    computeHumidity(water, flat, W, 1, 45, 45, HUM, o2);
    expect(o2[55]).toBeGreaterThan(out[55]! * 2);
  });
});

describe('Mélange méridien et apport local', () => {
  it('moyenne entière sur la fenêtre verticale, terre seulement ; r = 0 = identité', () => {
    const W = 1;
    const water = Uint8Array.from([0, 0, 1, 0, 0]);
    const hum = Uint8Array.from([10, 20, 255, 40, 51]);
    const a = hum.slice();
    mixHumidityVertically(water, a, W, 5, 0);
    expect(Array.from(a)).toEqual(Array.from(hum));
    mixHumidityVertically(water, a, W, 5, 1);
    // y0 : (10+20)/2 = 15 ; y1 : (10+20+255)/3 = 95 ; y2 eau ; y3 : (255+40+51)/3 = 115,3 → 115 ; y4 : (40+51)/2 = 45,5 → 45
    expect(Array.from(a)).toEqual([15, 95, 255, 115, 45]);
  });

  it('apport local : 0 pour l\'océan, max(0, humidité − seuil) sinon', () => {
    expect(localRunoff(1, 255, 30)).toBe(0);
    expect(localRunoff(0, 200, 30)).toBe(170);
    expect(localRunoff(2, 31, 30)).toBe(1);
    expect(localRunoff(0, 10, 30)).toBe(0);
  });
});
