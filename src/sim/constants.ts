import type { PitchType } from "../players/types";

/**
 * Every tunable number in the engine lives here so calibration has one place
 * to look. Probabilities are written as probabilities for readability and
 * converted to log-odds where the engine adds skill adjustments.
 *
 * Unless noted, a "z" is a 20-80 grade converted to standard deviations:
 * (grade - 50) / 10.
 *
 * Reference points (MLB 2024-25): ~3.9 pitches/PA, ~47% swing rate, ~11%
 * swinging-strike rate, ~49% zone rate, ~88-89 mph average exit velocity.
 */

/** Statcast "attack regions": heart of the zone, the edges, chase, and waste. */
export type Region = "heart" | "shadow" | "chase" | "waste";
export const REGIONS: readonly Region[] = ["heart", "shadow", "chase", "waste"];

export const ENGINE = {
  location: {
    /** Share of pitches in each region for an average pitcher in a neutral count. */
    base: { heart: 0.27, shadow: 0.45, chase: 0.21, waste: 0.065 },
    /** Log-weight shifts per z of control / command. */
    controlInZone: 0.1,
    controlWaste: -0.42,
    commandHeart: -0.18,
    commandShadow: 0.08,
    commandWaste: -0.15,
    /** Fastballs live in the zone; secondaries get chased. */
    fastballInZone: 0.12,
    secondaryInZone: -0.14,
    secondaryChase: 0.16,
  },

  /**
   * Count effects on location: [in-zone shift, chase shift, waste shift] as
   * log-weights. Behind in the count pitchers come into the zone; ahead they
   * expand.
   */
  countLocation: {
    "0-0": [0.12, 0, -0.1],
    "1-0": [0.12, 0, -0.05],
    "2-0": [0.3, -0.1, -0.35],
    "3-0": [0.6, -0.4, -0.9],
    "0-1": [-0.05, 0.1, 0.1],
    "1-1": [0, 0.05, 0],
    "2-1": [0.15, 0, -0.2],
    "3-1": [0.4, -0.2, -0.55],
    "0-2": [-0.45, 0.35, 0.45],
    "1-2": [-0.3, 0.25, 0.25],
    "2-2": [-0.1, 0.1, 0.05],
    "3-2": [0.3, -0.05, -0.35],
  } as Record<string, [number, number, number]>,

  swing: {
    /** Swing probability by region for an average hitter in a neutral count. */
    base: { heart: 0.72, shadow: 0.48, chase: 0.235, waste: 0.055 },
    /** Log-odds shift per z of the hitter's eye, by region. */
    eye: { heart: 0.05, shadow: -0.08, chase: -0.34, waste: -0.4 },
    /** Better stuff induces more chases. */
    stuffChase: 0.12,
    /** With two strikes hitters protect: much more likely to swing at anything close. */
    twoStrike: { heart: 1.8, shadow: 1.0, chase: 0.15, waste: 0 },
  },

  /** Log-odds shift on swinging by count. */
  countSwing: {
    "0-0": -0.62,
    "1-0": -0.2,
    "2-0": -0.2,
    "3-0": -2.3,
    "0-1": 0.1,
    "1-1": 0.15,
    "2-1": 0.25,
    "3-1": 0.2,
    "0-2": 0.05,
    "1-2": 0.12,
    "2-2": 0.22,
    "3-2": 0.4,
  } as Record<string, number>,

  whiff: {
    /** Whiff probability per swing by region, average hitter vs average pitch. */
    base: { heart: 0.165, shadow: 0.28, chase: 0.45, waste: 0.6 },
    /** Log-odds per z. */
    contact: -0.37,
    stuff: 0.31,
    /** Two-strike swings are shorter: more contact, weaker contact. */
    twoStrike: -0.6,
    /** Log-odds adjustment by pitch type. */
    pitchType: { FF: -0.12, SI: -0.45, FC: -0.02, SL: 0.33, ST: 0.28, CU: 0.22, CH: 0.26, FS: 0.38 } as Record<PitchType, number>,
  },

  /** Probability a contacted pitch is put in play (vs fouled off). */
  fair: {
    base: { heart: 0.52, shadow: 0.43, chase: 0.35, waste: 0.3 },
    twoStrike: -0.25,
    /** Share of fouls that are catchable pop-ups (foul outs). */
    foulOut: 0.03,
  },

  take: {
    /** Probability a taken pitch is called a strike, by region. */
    calledStrike: { heart: 0.985, shadow: 0.47, chase: 0.035, waste: 0 },
    /** Log-odds per z of catcher receiving on shadow pitches. */
    framing: 0.15,
    /** Log-odds per z of pitcher command on shadow pitches (painting the corners). */
    commandPaint: 0.08,
    /** Chance a taken waste pitch hits the batter. */
    hbpPerWaste: 0.038,
  },

  /** Wild pitch / passed ball chance on a taken chase-or-waste pitch with runners on. */
  wildPitch: { chase: 0.004, waste: 0.035, breakingMult: 1.5, catcherZ: -0.3 },

  contact: {
    /** Probability contact is "weak" (topped, jammed, under it). */
    weakBase: 0.24,
    weakRegion: { heart: -0.7, shadow: 0, chase: 0.55, waste: 0.9 },
    weakContact: -0.4,
    weakStuff: 0.15,
    weakTwoStrike: 0.2,
    weakEV: 71,
    weakEVsd: 10,
    /** Weak contact splits into topped grounders, pop-ups (under it), and bloops. */
    weakTopped: 0.55,
    weakUnder: 0.21,
    solidEV: 95.8,
    solidEVsd: 7.5,
    /** mph per z of raw power, of bat-to-ball skill (squaring it up), and of pitch grade. */
    powerEV: 2.3,
    contactEV: 0.3,
    stuffEV: -0.6,
    regionEV: { heart: 2.5, shadow: 0, chase: -2.5, waste: -4 },
    /** Mean launch angle and spread for solid contact. */
    laMean: 14.5,
    laSd: 19,
    /** Degrees per z of the hitter's launch trait. */
    launchLA: 5.5,
    /** Exit velocity lost per squared degree away from the sweet launch angle. */
    evLaPenalty: 0.0045,
    evLaPenaltyMax: 22,
    sweetLA: 14,
    pitchLA: { FF: 4, SI: -6, FC: 0, SL: -1, ST: 0, CU: -3, CH: -3, FS: -5 } as Record<PitchType, number>,
  },

  spray: {
    /** Pull-side mean spray angle (degrees) for grounders and air balls. */
    groundPull: 9,
    airPull: 2,
    /** Degrees per z of pull tendency. */
    groundPullZ: 4,
    airPullZ: 3,
    groundSd: 19,
    airSd: 22,
  },

  /** Platoon: batter z shift when facing a same-handed / opposite-handed pitcher. */
  platoon: { same: -0.2, opposite: 0.08 },
  /** Batter z bonus by time through the order (1st, 2nd, 3rd, 4th+). */
  timesThrough: [0, 0.06, 0.13, 0.18],

  fatigue: {
    /** Fatigue starts this many pitches before a pitcher's limit... */
    window: 18,
    /** ...and costs this many z per pitch after that. */
    perPitch: 0.035,
    /** Game-to-game jitter in a starter's pitch limit. */
    limitJitter: 5,
    /** Cap on the fatigue penalty (z). */
    max: 1.5,
  },

  /**
   * Baserunning decisions. Each optional advance computes a success
   * probability (log-odds below); the runner goes only if it clears the
   * send threshold, then succeeds with that probability.
   */
  running: {
    secondHomeOnSingle: 1.2,
    firstThirdOnSingle: 0.35,
    firstHomeOnDouble: -0.4,
    speed: 0.9,
    arm: 0.5,
    aggression: 0.25,
    twoOuts: 1.3,
    sendThreshold: 0.72,
    sendThresholdTwoOuts: 0.58,
    firstThirdThreshold: 0.72,
    /** Balls hit to right field make first-to-third easier (long throw). */
    rightField: 0.8,
    leftField: -0.6,
    // Ground-ball outs
    dpBase: -0.35,
    dpEV: 0.05,
    dpSpeed: 0.55,
    dpFielder: 0.3,
    dpCorner: -0.5,
    forceAtSecond: 0.55,
    scoreFromThirdOnGrounder: 0.1,
    advanceSecondOnGrounder: -0.2,
    rightSide: 1.2,
    // Fly-ball outs
    sacFlyDistance: 245,
    sacFlyScale: 22,
    sacFlyThreshold: 0.55,
    tagThirdDistance: 300,
  },

  steal: {
    /** Attempts per pitch for an average runner with the next base open. */
    attempt: 0.0112,
    speed: 1.0,
    aggression: 0.35,
    minSpeed: -0.8,
    thirdMult: 0.12,
    success: 0.75,
    successSpeed: 0.75,
    catcherArm: 0.45,
    thirdPenalty: 0.3,
  },

  errors: {
    ground: 0.06,
    air: 0.012,
    /** Log multiplier per z of the fielder's defense at the position. */
    skill: -0.35,
  },
} as const;
