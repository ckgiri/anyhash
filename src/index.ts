/**
 * anyhash - a stable hash for any JavaScript value.
 *
 *   anyhash({ a: 1, b: [2, 3] }) === anyhash({ b: [2, 3], a: 1 })   // true
 *   anyhash(new Map([[1, 'x']]))         // 'db98a62473734c74248540c2144fb29b' (32 hex chars, 128-bit)
 *   await anyhash.sha256(value)          // SHA-256 via Web Crypto (64 hex chars)
 *   anyhash.serialize(value)             // the canonical string that gets hashed
 */

import { HEX, murmur128 } from './murmur';

export interface AnyhashOptions {
  /**
   * Object keys to leave out, at every level: a list of names, or a function that returns `true`
   * for keys to skip. Applies to plain objects, class instances and Error properties (not Map keys).
   */
  ignoreKeys?: readonly string[] | ((key: string, value: unknown) => boolean);
  /** Treat arrays as unordered, so `[1, 2]` and `[2, 1]` hash the same. Default `false`. */
  unorderedArrays?: boolean;
  /** Treat Sets as unordered (insertion order does not matter). Default `true`. */
  unorderedSets?: boolean;
  /** Treat Maps as unordered (insertion order does not matter). Default `true`. */
  unorderedMaps?: boolean;
}

const objectProto = Object.prototype;
const getProto = Object.getPrototypeOf;
const keysOf = Object.keys;
const isArray = Array.isArray;
const isView = ArrayBuffer.isView;
const toStringTag = (v: object): string => objectProto.toString.call(v);
const jsonQuote = JSON.stringify as (s: string) => string;
const NEEDS_ESCAPE = /["\\\u0000-\u001f\ud800-\udfff]/;

/**
 * JSON string quoting. Lone surrogates are escaped too (`"\ud800"`), so the serialization is
 * always well-formed Unicode and encodes to UTF-8 without loss.
 */
function quote(s: string): string {
  return NEEDS_ESCAPE.test(s) ? jsonQuote(s) : '"' + s + '"';
}

function num(n: number): string {
  return n === 0 && 1 / n < 0 ? '-0' : '' + n;
}

/** Hex of a byte range. Detached buffers have length 0 and give ''. */
function bytesHex(buffer: ArrayBufferLike, offset = 0, length = buffer.byteLength): string {
  if (!length) return '';
  const bytes = new Uint8Array(buffer, offset, length);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]!]!;
  return s;
}

/** Sorts strings by UTF-16 code unit. Insertion sort is faster than Array#sort for small arrays. */
function sortStrings(a: string[]): string[] {
  const n = a.length;
  if (n > 24) return a.sort();
  for (let i = 1; i < n; i++) {
    const k = a[i]!;
    let j = i - 1;
    if (a[j]! <= k) continue;
    do {
      a[j + 1] = a[j]!;
      j--;
    } while (j >= 0 && a[j]! > k);
    a[j + 1] = k;
  }
  return a;
}

const FAIL: unique symbol = Symbol('fail');

/** Calls a built-in method on `v`. Returns FAIL if `v` lacks the internal slots (a fake with a spoofed Symbol.toStringTag). */
function tryCall(method: (this: any) => unknown, v: object): unknown {
  try {
    return method.call(v);
  } catch {
    return FAIL;
  }
}

function ctorName(proto: object | null): string {
  if (proto === null) return 'Object';
  const c = (proto as { constructor?: unknown }).constructor;
  return typeof c === 'function' && typeof c.name === 'string' ? c.name : '';
}

/** `Kind` for built-ins, or `Kind:"Subclass"` when the value is an instance of a subclass. */
function tag(kind: string, v: object): string {
  const name = ctorName(getProto(v));
  return name === kind ? kind : kind + ':' + quote(name);
}

const getter = (proto: object, key: string) => Object.getOwnPropertyDescriptor(proto, key)!.get as (this: any) => unknown;
const dateGetTime = Date.prototype.getTime;
const regexpSource = getter(RegExp.prototype, 'source');
const regexpFlags = getter(RegExp.prototype, 'flags');
const mapSize = getter(Map.prototype, 'size');
const setSize = getter(Set.prototype, 'size');
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const abByteLength = getter(ArrayBuffer.prototype, 'byteLength');
const sabByteLength = typeof SharedArrayBuffer === 'function' ? getter(SharedArrayBuffer.prototype, 'byteLength') : undefined;

/** Boxed primitives (new Number(1), Object(1n), ...) by their Object.prototype.toString tag. */
const BOXED: Record<string, [kind: string, valueOf: (this: any) => unknown]> = {
  '[object Number]': ['Number', Number.prototype.valueOf],
  '[object String]': ['String', String.prototype.valueOf],
  '[object Boolean]': ['Boolean', Boolean.prototype.valueOf],
  '[object Symbol]': ['Symbol', Symbol.prototype.valueOf],
  '[object BigInt]': ['BigInt', BigInt.prototype.valueOf],
};

const BYTE_ARRAYS = new Set(['Uint8Array', 'Int8Array', 'Uint8ClampedArray', 'DataView']);

/**
 * Builds the canonical string for a value. Every value gets a type-tagged, unambiguous form,
 * so values that are logically different never produce the same string.
 */
function serializer(options: AnyhashOptions | undefined): (value: unknown) => string {
  const opts = options ?? {};
  const unorderedArrays = opts.unorderedArrays === true;
  const unorderedSets = opts.unorderedSets !== false;
  const unorderedMaps = opts.unorderedMaps !== false;
  const ig = opts.ignoreKeys;
  let skip: ((key: string, value: unknown) => boolean) | undefined;
  if (typeof ig === 'function') skip = ig;
  else if (ig != null) {
    if (!isArray(ig)) throw new TypeError('anyhash: ignoreKeys must be an array of strings or a function');
    const ignored = new Set<string>(ig);
    if (ignored.size) skip = (k) => ignored.has(k);
  }

  // Objects currently being serialized, root first. A repeat means a circular reference.
  const stack: object[] = [];

  function ser(v: unknown): string {
    switch (typeof v) {
      case 'string':
        return quote(v);
      case 'number':
        return num(v);
      case 'boolean':
        return v ? 'true' : 'false';
      case 'undefined':
        return 'undefined';
      case 'bigint':
        return v + 'n';
      case 'symbol': {
        const key = Symbol.keyFor(v);
        if (key !== undefined) return 'Symbol.for(' + quote(key) + ')';
        return v.description === undefined ? 'Symbol()' : 'Symbol(' + quote(v.description) + ')';
      }
      case 'function':
        return 'Function(' + quote(String(v.name)) + ',' + quote(Function.prototype.toString.call(v)) + ')';
    }
    if (v === null) return 'null';
    return obj(v as object);
  }

  function enter(v: object): string | undefined {
    const i = stack.indexOf(v);
    if (i !== -1) return 'Circular(' + i + ')';
    stack.push(v);
    return undefined;
  }

  function body(v: any): string {
    const keys = sortStrings(keysOf(v));
    let out = '{';
    let first = true;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const x = v[k];
      if (skip && skip(k, x)) continue;
      if (first) first = false;
      else out += ',';
      out += quote(k) + ':' + ser(x);
    }
    return out + '}';
  }

  function list(items: string[], unordered: boolean, open: string, close: string): string {
    if (unordered) sortStrings(items);
    return open + items.join(',') + close;
  }

  function obj(v: object): string {
    if (isArray(v)) {
      const c = enter(v);
      if (c) return c;
      let out: string;
      if (unorderedArrays) {
        const items: string[] = new Array(v.length);
        for (let i = 0; i < v.length; i++) items[i] = ser(v[i]);
        out = list(items, true, '[', ']');
      } else {
        out = '[';
        for (let i = 0; i < v.length; i++) {
          if (i) out += ',';
          out += ser(v[i]);
        }
        out += ']';
      }
      stack.pop();
      return getProto(v) === Array.prototype || ctorName(getProto(v)) === 'Array' ? out : tag('Array', v) + out;
    }

    const proto = getProto(v);
    if (proto === objectProto || proto === null) {
      const c = enter(v);
      if (c) return c;
      const out = body(v);
      stack.pop();
      return out;
    }

    if (isView(v)) return view(v);

    const t = toStringTag(v);
    switch (t) {
      case '[object Date]': {
        const time = tryCall(dateGetTime, v);
        if (time !== FAIL) return tag('Date', v) + '(' + num(time as number) + ')';
        break;
      }
      case '[object RegExp]': {
        const source = tryCall(regexpSource, v);
        // source is always escaped ('/' becomes '\/'), so '/source/flags' is unambiguous.
        if (source !== FAIL) return tag('RegExp', v) + '(' + quote('/' + source + '/' + regexpFlags.call(v)) + ')';
        break;
      }
      case '[object Map]':
        if (tryCall(mapSize, v) !== FAIL) return map(v as Map<unknown, unknown>);
        break;
      case '[object Set]':
        if (tryCall(setSize, v) !== FAIL) return set(v as Set<unknown>);
        break;
      case '[object Error]':
        return error(v as Error);
      case '[object ArrayBuffer]':
        if (tryCall(abByteLength, v) !== FAIL) return tag('ArrayBuffer', v) + '(' + bytesHex(v as ArrayBuffer) + ')';
        break;
      case '[object SharedArrayBuffer]':
        if (sabByteLength && tryCall(sabByteLength, v) !== FAIL) {
          return tag('SharedArrayBuffer', v) + '(' + bytesHex(v as SharedArrayBuffer) + ')';
        }
        break;
      default: {
        const box = BOXED[t];
        if (box) {
          const prim = tryCall(box[1], v);
          if (prim !== FAIL) return tag(box[0], v) + '(' + ser(prim) + ')';
        }
      }
    }
    if (v instanceof Error) return error(v); // e.g. DOMException, which has its own toStringTag

    // Any other object: a class instance, or a plain object from another realm.
    const name = ctorName(proto);
    const c = enter(v);
    if (c) return c;
    let out: string;
    if (name === 'Object') out = body(v);
    else if (typeof (v as { toJSON?: unknown }).toJSON === 'function') {
      // Classes like URL, Temporal, Decimal keep their state in private slots; toJSON exposes it.
      out = '@' + quote(name) + '=' + ser((v as { toJSON: () => unknown }).toJSON());
    } else out = '@' + quote(name) + body(v);
    stack.pop();
    return out;
  }

  function view(v: ArrayBufferView): string {
    const kind = toStringTag(v).slice(8, -1); // 'Uint8Array', 'Float64Array', 'DataView', ...
    if (BYTE_ARRAYS.has(kind)) {
      return tag(kind, v) + '(' + bytesHex(v.buffer, v.byteOffset, v.byteLength) + ')';
    }
    const arr = v as unknown as ArrayLike<number | bigint>;
    let out = tag(kind, v) + '(';
    for (let i = 0; i < arr.length; i++) {
      if (i) out += ',';
      const x = arr[i]!;
      out += typeof x === 'bigint' ? x + 'n' : num(x);
    }
    return out + ')';
  }

  function map(m: Map<unknown, unknown>): string {
    const c = enter(m);
    if (c) return c;
    const items: string[] = [];
    mapForEach.call(m, (val: unknown, key: unknown) => {
      items.push(ser(key) + '=>' + ser(val));
    });
    stack.pop();
    return list(items, unorderedMaps, tag('Map', m) + '{', '}');
  }

  function set(s: Set<unknown>): string {
    const c = enter(s);
    if (c) return c;
    const items: string[] = [];
    setForEach.call(s, (val: unknown) => {
      items.push(ser(val));
    });
    stack.pop();
    return list(items, unorderedSets, tag('Set', s) + '[', ']');
  }

  function error(e: Error): string {
    const c = enter(e);
    if (c) return c;
    // name and message usually live on the prototype or are non-enumerable; stack is left out
    // because it depends on where the error was created.
    const fields: Record<string, unknown> = Object.create(null);
    fields.name = e.name;
    fields.message = e.message;
    for (const k of keysOf(e)) if (k !== 'stack') fields[k] = (e as unknown as Record<string, unknown>)[k];
    if (Object.prototype.hasOwnProperty.call(e, 'cause')) fields.cause = e.cause;
    if (Object.prototype.hasOwnProperty.call(e, 'errors')) fields.errors = (e as { errors?: unknown }).errors;
    const out = tag('Error', e) + body(fields);
    stack.pop();
    return out;
  }

  return ser;
}

/**
 * The canonical string for a value: what `anyhash` and `anyhash.sha256` hash. Two values have the
 * same hash exactly when this string is the same, so comparing it shows why two hashes differ.
 */
export function serialize(value: unknown, options?: AnyhashOptions): string {
  return serializer(options)(value);
}

/**
 * Prepended before hashing. It fills one whole MurmurHash3 block, so all four 32-bit lanes are
 * mixed even for tiny inputs like `1`, and it names the format version.
 */
const HASH_PREFIX = 'anyhash1';

/**
 * Fast, stable 128-bit hash of any value, as 32 hex characters: MurmurHash3 x86 128 (seed 0) of the
 * UTF-16LE bytes of `'anyhash1' + serialize(value)`.
 * Not cryptographic: use `sha256` when hashes must resist deliberate collisions.
 */
export function hash(value: unknown, options?: AnyhashOptions): string {
  return murmur128(HASH_PREFIX + serializer(options)(value));
}

/** SHA-256 (via Web Crypto) of the UTF-8 encoded `serialize(value)`, as 64 hex characters. */
export async function sha256(value: unknown, options?: AnyhashOptions): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw new Error('anyhash: crypto.subtle is not available in this runtime (it needs a secure context in browsers)');
  const data = new TextEncoder().encode(serializer(options)(value));
  return bytesHex(await subtle.digest('SHA-256', data));
}

type Anyhash = typeof hash & {
  hash: typeof hash;
  sha256: typeof sha256;
  serialize: typeof serialize;
};

/** `anyhash(value)` returns a 32-character hex hash. `sha256` and `serialize` are also available as properties. */
const anyhash: Anyhash = Object.assign((value: unknown, options?: AnyhashOptions) => hash(value, options), {
  hash,
  sha256,
  serialize,
});

export { anyhash };
export default anyhash;
