import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { hash, serialize } from '../src/index';

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small value domains so that equal values come up often. */
function makeGen(seed: number) {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const prims = [0, -0, 1, 2, NaN, Infinity, 1n, 2n, '', '0', '1', 'a', 'b', true, false, null, undefined];

  function gen(depth: number): unknown {
    const x = r();
    if (depth <= 0 || x < 0.4) return pick(prims);
    const n = Math.floor(r() * 3);
    if (x < 0.55) return Array.from({ length: n }, () => gen(depth - 1));
    if (x < 0.75) {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) o[pick(['a', 'b', 'c', '1'])] = gen(depth - 1);
      return o;
    }
    if (x < 0.83) return new Map(Array.from({ length: n }, () => [gen(depth - 1), gen(depth - 1)] as [unknown, unknown]));
    if (x < 0.9) return new Set(Array.from({ length: n }, () => gen(depth - 1)));
    if (x < 0.94) return new Date(pick([0, 1])); // not NaN: isDeepStrictEqual says two invalid dates differ
    if (x < 0.97) return pick([Uint8Array, Int8Array, Float64Array]).from(Array.from({ length: n }, () => pick([0, 1, 2])));
    return pick([/a/, /a/g, /b/]);
  }
  return { gen, r };
}

/** Deep copy with object keys, Map entries and Set members in a different order. */
function shuffledClone(v: unknown, r: () => number): unknown {
  const shuffle = <T>(a: T[]): T[] => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  if (Array.isArray(v)) return v.map((x) => shuffledClone(x, r));
  if (v instanceof Map) return new Map(shuffle([...v].map(([k, x]) => [shuffledClone(k, r), shuffledClone(x, r)] as [unknown, unknown])));
  if (v instanceof Set) return new Set(shuffle([...v].map((x) => shuffledClone(x, r))));
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof RegExp) return new RegExp(v.source, v.flags);
  if (ArrayBuffer.isView(v)) return (v as Uint8Array).slice();
  if (v && typeof v === 'object') {
    const keys = shuffle(Object.keys(v));
    return Object.fromEntries(keys.map((k) => [k, shuffledClone((v as Record<string, unknown>)[k], r)]));
  }
  return v;
}

describe('fuzz against util.isDeepStrictEqual', () => {
  it('values with the same hash are deep-equal (no false merges)', () => {
    const { gen } = makeGen(1);
    const groups = new Map<string, unknown>();
    let merged = 0;
    for (let i = 0; i < 20_000; i++) {
      const v = gen(4);
      const h = hash(v);
      const first = groups.get(h);
      if (first === undefined && !groups.has(h)) {
        groups.set(h, v);
        continue;
      }
      merged++;
      if (!isDeepStrictEqual(first, v)) {
        throw new Error(`different values share a hash:\n${serialize(first)}\n${serialize(v)}`);
      }
    }
    expect(merged).toBeGreaterThan(1000); // the small domain really does produce many equal values
    expect(groups.size).toBeGreaterThan(1000);
  });

  it('deep-equal values with shuffled key/entry order hash the same', () => {
    const { gen, r } = makeGen(2);
    for (let i = 0; i < 5000; i++) {
      const v = gen(5);
      const c = shuffledClone(v, r);
      expect(isDeepStrictEqual(v, c)).toBe(true);
      expect(hash(c)).toBe(hash(v));
    }
  });
});
