import { clamp, logit, sigmoid } from "../core/math";
import type { Rng } from "../core/rng";
import type { PitchType } from "../players/types";
import { battedBallType, type BattedBall } from "./battedBall";
import { ENGINE, REGIONS, type Region } from "./constants";
import type { BatterProfile, PitcherProfile, PitchProfile } from "./profiles";

/**
 * One pitch: choose a pitch type and a location region, then the batter
 * decides to swing, then contact / foul / fair, then (if fair) a batted ball.
 */

export interface PitchContext {
  batter: BatterProfile;
  pitcher: PitcherProfile;
  /** z-points subtracted from the pitcher's stuff, control and command. */
  fatigue: number;
  /** z-points added to the batter's contact and power (platoon + times through order). */
  batterBoost: number;
  /** -1 when the batter hits right-handed (pulls to left field), +1 left-handed. */
  pullSign: number;
  /** Catcher receiving z (framing) and whether anyone is on base (wild pitches). */
  catcherFraming: number;
  runnersOn: boolean;
}

export type PitchKind = "ball" | "called" | "whiff" | "foul" | "foulOut" | "inPlay" | "hbp";

export interface PitchOutcome {
  kind: PitchKind;
  pitchType: PitchType;
  region: Region;
  swung: boolean;
  wildPitch: boolean;
  /** For shadow-region takes: called-strike probability with this catcher vs. an average one. */
  framing?: { actual: number; average: number };
  ball?: BattedBall;
  weak?: boolean;
}

type RegionMap = Record<Region, number>;
const logits = (m: RegionMap): RegionMap => ({
  heart: logit(m.heart),
  shadow: logit(m.shadow),
  chase: logit(m.chase),
  waste: m.waste > 0 ? logit(m.waste) : -Infinity,
});

const SWING = logits(ENGINE.swing.base);
const WHIFF = logits(ENGINE.whiff.base);
const FAIR = logits(ENGINE.fair.base);
const CALLED = {
  heart: logit(ENGINE.take.calledStrike.heart),
  shadow: logit(ENGINE.take.calledStrike.shadow),
  chase: logit(ENGINE.take.calledStrike.chase),
};
const WEAK_BASE = logit(ENGINE.contact.weakBase);
const BREAKING: ReadonlySet<PitchType> = new Set(["SL", "ST", "CU", "FS", "CH"]);

function choosePitch(p: PitcherProfile, balls: number, strikes: number, rng: Rng): PitchProfile {
  const behind = balls >= 2 && balls > strikes;
  const putAway = strikes === 2 && balls < 3;
  const w = p.pitches.map((x) => x.usage * (x.fastball ? (behind ? 1.4 : 1) : putAway ? 1.25 : 1));
  return p.pitches[rng.weightedIndex(w)]!;
}

function chooseRegion(pitch: PitchProfile, control: number, command: number, count: string, rng: Rng): Region {
  const L = ENGINE.location;
  const c = ENGINE.countLocation[count]!;
  const inZone = L.controlInZone * control + c[0] + (pitch.fastball ? L.fastballInZone : L.secondaryInZone);
  const weights = [
    L.base.heart * Math.exp(inZone + L.commandHeart * command),
    L.base.shadow * Math.exp(0.6 * inZone + L.commandShadow * command),
    L.base.chase * Math.exp(c[1] + (pitch.fastball ? 0 : L.secondaryChase)),
    L.base.waste * Math.exp(L.controlWaste * control + c[2]),
  ];
  return REGIONS[rng.weightedIndex(weights)]!;
}

export function generateBattedBall(
  ctx: PitchContext,
  pitch: PitchProfile,
  stuff: number,
  region: Region,
  strikes: number,
  rng: Rng,
): { ball: BattedBall; weak: boolean } {
  const C = ENGINE.contact;
  const b = ctx.batter;
  const weakP = sigmoid(
    WEAK_BASE +
      C.weakRegion[region] +
      C.weakContact * (b.contact + ctx.batterBoost) +
      C.weakStuff * stuff +
      (strikes === 2 ? C.weakTwoStrike : 0),
  );
  const weak = rng.chance(weakP);
  let ev: number;
  let la: number;
  if (weak) {
    ev = rng.normal(C.weakEV, C.weakEVsd);
    const r = rng.next();
    la = r < C.weakTopped ? rng.normal(-12 + 0.5 * C.pitchLA[pitch.type], 12) : r < C.weakTopped + C.weakUnder ? rng.normal(52, 12) : rng.normal(18, 10);
  } else {
    ev = rng.normal(
      C.solidEV + C.powerEV * (b.power + ctx.batterBoost) + C.stuffEV * stuff + C.regionEV[region],
      C.solidEVsd,
    );
    la = rng.normal(C.laMean + C.launchLA * b.launch + C.pitchLA[pitch.type], C.laSd);
    const off = la - C.sweetLA;
    ev -= Math.min(C.evLaPenaltyMax, C.evLaPenalty * off * off);
  }
  ev = clamp(ev, 25, 121);
  la = clamp(la, -80, 88);

  const S = ENGINE.spray;
  const ground = battedBallType(la) === "GB";
  const mean = ctx.pullSign * (ground ? S.groundPull + S.groundPullZ * b.pull : S.airPull + S.airPullZ * b.pull);
  const sd = ground ? S.groundSd : S.airSd;
  let spray = rng.normal(mean, sd);
  for (let i = 0; i < 3 && Math.abs(spray) > 44.5; i++) spray = rng.normal(mean, sd);
  spray = clamp(spray, -44.5, 44.5);
  return { ball: { ev, la, spray }, weak };
}

export function simulatePitch(ctx: PitchContext, balls: number, strikes: number, rng: Rng): PitchOutcome {
  const count = `${balls}-${strikes}`;
  const p = ctx.pitcher;
  const b = ctx.batter;
  const pitch = choosePitch(p, balls, strikes, rng);
  const stuff = pitch.z - ctx.fatigue;
  const region = chooseRegion(pitch, p.control - ctx.fatigue, p.command - ctx.fatigue, count, rng);
  const base = { pitchType: pitch.type, region, wildPitch: false };

  // Swing decision
  const S = ENGINE.swing;
  const outside = region === "chase" || region === "waste";
  let swingLogit = SWING[region] + ENGINE.countSwing[count]! + S.eye[region] * b.eye;
  if (strikes === 2) swingLogit += S.twoStrike[region];
  if (outside) swingLogit += S.stuffChase * stuff;
  const swung = rng.chance(sigmoid(swingLogit));

  if (!swung) {
    if (region === "waste" && rng.chance(ENGINE.take.hbpPerWaste)) {
      return { ...base, kind: "hbp", swung };
    }
    let pStrike: number;
    let framing: PitchOutcome["framing"];
    if (region === "shadow") {
      const average = sigmoid(CALLED.shadow);
      pStrike = sigmoid(CALLED.shadow + ENGINE.take.framing * ctx.catcherFraming);
      framing = { actual: pStrike, average };
    } else {
      pStrike = region === "waste" ? 0 : sigmoid(CALLED[region]);
    }
    const called = rng.chance(pStrike);
    let wildPitch = false;
    if (!called && outside && ctx.runnersOn) {
      const W = ENGINE.wildPitch;
      const pw = (region === "waste" ? W.waste : W.chase) * (BREAKING.has(pitch.type) ? W.breakingMult : 1);
      wildPitch = rng.chance(pw);
    }
    return { ...base, kind: called ? "called" : "ball", swung, wildPitch, ...(framing ? { framing } : {}) };
  }

  // Contact
  const W = ENGINE.whiff;
  const whiffLogit =
    WHIFF[region] +
    W.contact * (b.contact + ctx.batterBoost) +
    W.stuff * stuff +
    (strikes === 2 ? W.twoStrike : 0) +
    W.pitchType[pitch.type];
  if (rng.chance(sigmoid(whiffLogit))) return { ...base, kind: "whiff", swung };

  const fairP = sigmoid(FAIR[region] + (strikes === 2 ? ENGINE.fair.twoStrike : 0));
  if (!rng.chance(fairP)) {
    return { ...base, kind: rng.chance(ENGINE.fair.foulOut) ? "foulOut" : "foul", swung };
  }

  const { ball, weak } = generateBattedBall(ctx, pitch, stuff, region, strikes, rng);
  return { ...base, kind: "inPlay", swung, ball, weak };
}
