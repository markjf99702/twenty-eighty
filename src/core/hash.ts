/**
 * Deterministic noise: random-looking numbers fixed by their inputs. Used
 * where a value has to come out the same every time it's asked for (a scout's
 * error, a crowd on a given night) without drawing from, or saving, a stream.
 */

export function mix(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** A uniform draw in [0, 1) fixed by its inputs. */
export function hashUniform(...xs: number[]): number {
  return mix(...xs, 3) / 4294967296;
}

/** A standard normal draw fixed by its inputs. */
export function hashNormal(...xs: number[]): number {
  const u1 = (mix(...xs, 1) + 1) / 4294967297;
  const u2 = mix(...xs, 2) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const seedCache = new Map<string, number>();

/** A league seed string as a number for the hashes above. */
export function seedHash(seed: string): number {
  let s = seedCache.get(seed);
  if (s === undefined) {
    s = 0;
    for (let i = 0; i < seed.length; i++) s = Math.imul(s ^ seed.charCodeAt(i), 16777619) >>> 0;
    seedCache.set(seed, s);
  }
  return s;
}
