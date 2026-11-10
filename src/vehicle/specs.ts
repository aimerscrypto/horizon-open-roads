// Vehicle definitions: physics tuning, presentation and audio character for the four cars.
export interface BodyStyle {
  /** procedural body profile, see carBody.ts */
  kind: 'supercar' | 'coupe' | 'gt' | 'suv';
  length: number; width: number; height: number; ride: number;
  paint: number; paint2?: number;
}
export interface CarSpec {
  id: string; name: string; klass: string; tagline: string; price: number;
  model: 'glb' | 'proc'; body: BodyStyle;
  mass: number; wheelbase: number; track: number; cgHeight: number; wheelRadius: number; wheelWidth: number;
  drive: 'rwd' | 'awd';
  /** rear torque share for AWD */ rearBias: number;
  maxTorque: number; peakRpm: number; redline: number; idle: number; gears: number[]; final: number; shiftTime: number;
  grip: number; rearGrip: number; offroad: number; brakeG: number;
  steerLock: number; steerFade: number;
  suspRest: number; suspTravel: number; springHz: number; damping: number; antiRoll: number;
  drag: number; downforce: number;
  /** 0..10 bars shown in the garage */
  stats: { speed: number; accel: number; handling: number; offroad: number };
  topKmh: number;
  audio: { cylinders: number; pitch: number; rasp: number; bass: number };
  cockpit: boolean;
}

export const CARS: CarSpec[] = [
  {
    id: 'coupe', name: 'Kestrel S', klass: 'Sports Coupe', tagline: 'Light, eager and happiest sideways.', price: 0,
    model: 'proc', body: { kind: 'coupe', length: 4.38, width: 1.86, height: 1.27, ride: 0.13, paint: 0xd4380d },
    mass: 1380, wheelbase: 2.58, track: 1.6, cgHeight: 0.46, wheelRadius: 0.335, wheelWidth: 0.27,
    drive: 'rwd', rearBias: 1,
    maxTorque: 470, peakRpm: 5200, redline: 7600, idle: 950, gears: [3.4, 2.2, 1.6, 1.24, 1.0, 0.82], final: 3.7, shiftTime: 0.17,
    grip: 1.22, rearGrip: 1.03, offroad: 0.62, brakeG: 1.15,
    steerLock: 0.6, steerFade: 34,
    suspRest: 0.3, suspTravel: 0.16, springHz: 2.1, damping: 0.62, antiRoll: 9000,
    drag: 0.46, downforce: 0.9,
    stats: { speed: 6.4, accel: 6.6, handling: 7.4, offroad: 3.0 }, topKmh: 262,
    audio: { cylinders: 6, pitch: 1.0, rasp: 0.5, bass: 0.5 }, cockpit: false,
  },
  {
    id: 'gt', name: 'Aurelia GT', klass: 'Grand Tourer', tagline: 'Twelve cylinders and a continent to cross.', price: 30000,
    model: 'proc', body: { kind: 'gt', length: 4.78, width: 1.94, height: 1.31, ride: 0.14, paint: 0x0e2a4a },
    mass: 1790, wheelbase: 2.82, track: 1.64, cgHeight: 0.5, wheelRadius: 0.35, wheelWidth: 0.28,
    drive: 'rwd', rearBias: 1,
    maxTorque: 740, peakRpm: 4600, redline: 7000, idle: 800, gears: [3.3, 2.15, 1.55, 1.2, 0.98, 0.8, 0.66], final: 3.25, shiftTime: 0.2,
    grip: 1.2, rearGrip: 1.05, offroad: 0.6, brakeG: 1.12,
    steerLock: 0.56, steerFade: 38,
    suspRest: 0.31, suspTravel: 0.17, springHz: 1.9, damping: 0.66, antiRoll: 11000,
    drag: 0.44, downforce: 1.0,
    stats: { speed: 8.0, accel: 7.2, handling: 6.4, offroad: 3.2 }, topKmh: 308,
    audio: { cylinders: 12, pitch: 0.92, rasp: 0.3, bass: 0.7 }, cockpit: false,
  },
  {
    id: 'suv', name: 'Bastion X', klass: 'Off-Road SUV', tagline: 'Long-travel suspension. The road is optional.', price: 45000,
    model: 'proc', body: { kind: 'suv', length: 4.72, width: 1.98, height: 1.82, ride: 0.3, paint: 0x4d5a3a },
    mass: 2150, wheelbase: 2.86, track: 1.68, cgHeight: 0.66, wheelRadius: 0.43, wheelWidth: 0.31,
    drive: 'awd', rearBias: 0.55,
    maxTorque: 700, peakRpm: 3600, redline: 6200, idle: 750, gears: [3.9, 2.4, 1.6, 1.18, 0.92, 0.74], final: 3.9, shiftTime: 0.24,
    grip: 1.05, rearGrip: 1.05, offroad: 1.0, brakeG: 1.0,
    steerLock: 0.6, steerFade: 30,
    suspRest: 0.46, suspTravel: 0.3, springHz: 1.55, damping: 0.6, antiRoll: 12000,
    drag: 0.72, downforce: 0.3,
    stats: { speed: 5.2, accel: 5.8, handling: 4.8, offroad: 9.6 }, topKmh: 226,
    audio: { cylinders: 8, pitch: 0.78, rasp: 0.25, bass: 1.0 }, cockpit: false,
  },
  {
    id: 'hyper', name: 'Vanta R', klass: 'Exotic Supercar', tagline: 'All-wheel drive, active aero, zero compromise.', price: 90000,
    model: 'glb', body: { kind: 'supercar', length: 4.6, width: 2.0, height: 1.16, ride: 0.11, paint: 0xf2b705 },
    mass: 1490, wheelbase: 2.72, track: 1.68, cgHeight: 0.4, wheelRadius: 0.35, wheelWidth: 0.31,
    drive: 'awd', rearBias: 0.68,
    maxTorque: 860, peakRpm: 6200, redline: 8800, idle: 1000, gears: [3.1, 2.1, 1.56, 1.22, 0.99, 0.82, 0.68], final: 3.45, shiftTime: 0.11,
    grip: 1.42, rearGrip: 1.06, offroad: 0.55, brakeG: 1.4,
    steerLock: 0.56, steerFade: 42,
    suspRest: 0.27, suspTravel: 0.13, springHz: 2.5, damping: 0.68, antiRoll: 14000,
    drag: 0.39, downforce: 2.6,
    stats: { speed: 9.6, accel: 9.7, handling: 9.2, offroad: 2.0 }, topKmh: 356,
    audio: { cylinders: 10, pitch: 1.18, rasp: 0.8, bass: 0.45 }, cockpit: true,
  },
];
export const carById = (id: string) => CARS.find(c => c.id === id) ?? CARS[0];
