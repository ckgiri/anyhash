/** Internal: the fast hash behind `anyhash()`. */

export const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * MurmurHash3 x86 128-bit (seed 0) of the string's UTF-16LE bytes, as 32 hex characters.
 * Reads two UTF-16 code units per 32-bit word, so no encoding step is needed.
 */
export function murmur128(str: string): string {
  const len = str.length;
  const blocks = len >> 3; // 8 code units = 16 bytes
  let h1 = 0;
  let h2 = 0;
  let h3 = 0;
  let h4 = 0;
  const c1 = 0x239b961b;
  const c2 = 0xab0e9789;
  const c3 = 0x38b34ae5;
  const c4 = 0xa1e38b93;
  const imul = Math.imul;
  let k1: number;
  let k2: number;
  let k3: number;
  let k4: number;
  let p = 0;

  for (let b = 0; b < blocks; b++, p += 8) {
    k1 = str.charCodeAt(p) | (str.charCodeAt(p + 1) << 16);
    k2 = str.charCodeAt(p + 2) | (str.charCodeAt(p + 3) << 16);
    k3 = str.charCodeAt(p + 4) | (str.charCodeAt(p + 5) << 16);
    k4 = str.charCodeAt(p + 6) | (str.charCodeAt(p + 7) << 16);

    k1 = imul(k1, c1); k1 = (k1 << 15) | (k1 >>> 17); k1 = imul(k1, c2); h1 ^= k1;
    h1 = (h1 << 19) | (h1 >>> 13); h1 = (h1 + h2) | 0; h1 = (imul(h1, 5) + 0x561ccd1b) | 0;
    k2 = imul(k2, c2); k2 = (k2 << 16) | (k2 >>> 16); k2 = imul(k2, c3); h2 ^= k2;
    h2 = (h2 << 17) | (h2 >>> 15); h2 = (h2 + h3) | 0; h2 = (imul(h2, 5) + 0x0bcaa747) | 0;
    k3 = imul(k3, c3); k3 = (k3 << 17) | (k3 >>> 15); k3 = imul(k3, c4); h3 ^= k3;
    h3 = (h3 << 15) | (h3 >>> 17); h3 = (h3 + h4) | 0; h3 = (imul(h3, 5) + 0x96cd1c35) | 0;
    k4 = imul(k4, c4); k4 = (k4 << 18) | (k4 >>> 14); k4 = imul(k4, c1); h4 ^= k4;
    h4 = (h4 << 13) | (h4 >>> 19); h4 = (h4 + h1) | 0; h4 = (imul(h4, 5) + 0x32ac3b17) | 0;
  }

  // Tail: 0-7 code units (an even number of bytes, 0-14).
  const r = len & 7;
  if (r >= 7) {
    k4 = str.charCodeAt(p + 6);
    k4 = imul(k4, c4); k4 = (k4 << 18) | (k4 >>> 14); k4 = imul(k4, c1); h4 ^= k4;
  }
  if (r >= 5) {
    k3 = str.charCodeAt(p + 4) | (r >= 6 ? str.charCodeAt(p + 5) << 16 : 0);
    k3 = imul(k3, c3); k3 = (k3 << 17) | (k3 >>> 15); k3 = imul(k3, c4); h3 ^= k3;
  }
  if (r >= 3) {
    k2 = str.charCodeAt(p + 2) | (r >= 4 ? str.charCodeAt(p + 3) << 16 : 0);
    k2 = imul(k2, c2); k2 = (k2 << 16) | (k2 >>> 16); k2 = imul(k2, c3); h2 ^= k2;
  }
  if (r >= 1) {
    k1 = str.charCodeAt(p) | (r >= 2 ? str.charCodeAt(p + 1) << 16 : 0);
    k1 = imul(k1, c1); k1 = (k1 << 15) | (k1 >>> 17); k1 = imul(k1, c2); h1 ^= k1;
  }

  const bytes = len * 2;
  h1 ^= bytes; h2 ^= bytes; h3 ^= bytes; h4 ^= bytes;
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;
  h1 = fmix(h1); h2 = fmix(h2); h3 = fmix(h3); h4 = fmix(h4);
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;

  return hex32(h1) + hex32(h2) + hex32(h3) + hex32(h4);
}

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}

function hex32(h: number): string {
  return HEX[h >>> 24]! + HEX[(h >>> 16) & 255]! + HEX[(h >>> 8) & 255]! + HEX[h & 255]!;
}
