import { describe, expect, it } from 'vitest';
import { murmur128 } from '../src/murmur';

/** Straight port of MurmurHash3_x86_128 from SMHasher, over bytes. Returns h1..h4. */
function reference(key: Uint8Array, seed: number): [number, number, number, number] {
  const len = key.length;
  const nblocks = len >> 4;
  let h1 = seed >>> 0, h2 = seed >>> 0, h3 = seed >>> 0, h4 = seed >>> 0;
  const c1 = 0x239b961b, c2 = 0xab0e9789, c3 = 0x38b34ae5, c4 = 0xa1e38b93;
  const rotl = (x: number, r: number) => (x << r) | (x >>> (32 - r));
  const word = (i: number) => key[i]! | (key[i + 1]! << 8) | (key[i + 2]! << 16) | (key[i + 3]! << 24);
  const mul = Math.imul;
  for (let i = 0; i < nblocks; i++) {
    let k1 = word(i * 16), k2 = word(i * 16 + 4), k3 = word(i * 16 + 8), k4 = word(i * 16 + 12);
    k1 = mul(k1, c1); k1 = rotl(k1, 15); k1 = mul(k1, c2); h1 ^= k1;
    h1 = rotl(h1, 19); h1 = (h1 + h2) | 0; h1 = (mul(h1, 5) + 0x561ccd1b) | 0;
    k2 = mul(k2, c2); k2 = rotl(k2, 16); k2 = mul(k2, c3); h2 ^= k2;
    h2 = rotl(h2, 17); h2 = (h2 + h3) | 0; h2 = (mul(h2, 5) + 0x0bcaa747) | 0;
    k3 = mul(k3, c3); k3 = rotl(k3, 17); k3 = mul(k3, c4); h3 ^= k3;
    h3 = rotl(h3, 15); h3 = (h3 + h4) | 0; h3 = (mul(h3, 5) + 0x96cd1c35) | 0;
    k4 = mul(k4, c4); k4 = rotl(k4, 18); k4 = mul(k4, c1); h4 ^= k4;
    h4 = rotl(h4, 13); h4 = (h4 + h1) | 0; h4 = (mul(h4, 5) + 0x32ac3b17) | 0;
  }
  const t = nblocks * 16;
  let k1 = 0, k2 = 0, k3 = 0, k4 = 0;
  /* eslint-disable no-fallthrough */
  switch (len & 15) {
    case 15: k4 ^= key[t + 14]! << 16;
    case 14: k4 ^= key[t + 13]! << 8;
    case 13: k4 ^= key[t + 12]!;
      k4 = mul(k4, c4); k4 = rotl(k4, 18); k4 = mul(k4, c1); h4 ^= k4;
    case 12: k3 ^= key[t + 11]! << 24;
    case 11: k3 ^= key[t + 10]! << 16;
    case 10: k3 ^= key[t + 9]! << 8;
    case 9: k3 ^= key[t + 8]!;
      k3 = mul(k3, c3); k3 = rotl(k3, 17); k3 = mul(k3, c4); h3 ^= k3;
    case 8: k2 ^= key[t + 7]! << 24;
    case 7: k2 ^= key[t + 6]! << 16;
    case 6: k2 ^= key[t + 5]! << 8;
    case 5: k2 ^= key[t + 4]!;
      k2 = mul(k2, c2); k2 = rotl(k2, 16); k2 = mul(k2, c3); h2 ^= k2;
    case 4: k1 ^= key[t + 3]! << 24;
    case 3: k1 ^= key[t + 2]! << 16;
    case 2: k1 ^= key[t + 1]! << 8;
    case 1: k1 ^= key[t]!;
      k1 = mul(k1, c1); k1 = rotl(k1, 15); k1 = mul(k1, c2); h1 ^= k1;
  }
  const fmix = (h: number) => {
    h ^= h >>> 16; h = mul(h, 0x85ebca6b); h ^= h >>> 13; h = mul(h, 0xc2b2ae35); return h ^ (h >>> 16);
  };
  h1 ^= len; h2 ^= len; h3 ^= len; h4 ^= len;
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;
  h1 = fmix(h1); h2 = fmix(h2); h3 = fmix(h3); h4 = fmix(h4);
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

const hex = (hs: number[]) => hs.map((h) => h.toString(16).padStart(8, '0')).join('');

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 255;
    out[i * 2 + 1] = s.charCodeAt(i) >>> 8;
  }
  return out;
}

describe('MurmurHash3 x86 128', () => {
  it('the reference port passes the SMHasher verification test (0xB3ECE62A)', () => {
    // Hash keys {}, {0}, {0,1}, ... {0..254} with seed 256-n, then hash the concatenated results.
    const all = new Uint8Array(256 * 16);
    for (let n = 0; n < 256; n++) {
      const key = Uint8Array.from({ length: n }, (_, i) => i);
      const hs = reference(key, 256 - n);
      const view = new DataView(all.buffer, n * 16, 16);
      hs.forEach((h, i) => view.setUint32(i * 4, h, true));
    }
    const final = reference(all, 0);
    expect(final[0]).toBe(0xb3ece62a);
  });

  it('matches the reference on the UTF-16LE bytes of random strings, all tail lengths', () => {
    let seed = 7;
    const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    for (let len = 0; len < 80; len++) {
      for (let k = 0; k < 20; k++) {
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(rand() < 0.7 ? 32 + Math.floor(rand() * 95) : Math.floor(rand() * 65536));
        expect(murmur128(s)).toBe(hex(reference(utf16le(s), 0)));
      }
    }
  });

  it('hashes the empty string to zero', () => {
    expect(murmur128('')).toBe('0'.repeat(32));
  });
});
