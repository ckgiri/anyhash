import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import anyhash, { anyhash as named, hash, serialize, sha256, type AnyhashOptions } from '../src/index';

const HEX32 = /^[0-9a-f]{32}$/;
const same = (a: unknown, b: unknown, o?: AnyhashOptions) => {
  expect(serialize(a, o)).toBe(serialize(b, o));
  expect(anyhash(a, o)).toBe(anyhash(b, o));
};
const differ = (a: unknown, b: unknown, o?: AnyhashOptions) => {
  expect(serialize(a, o)).not.toBe(serialize(b, o));
  expect(anyhash(a, o)).not.toBe(anyhash(b, o));
};

/** Every pair in the list must hash differently. */
function allDistinct(values: unknown[], o?: AnyhashOptions) {
  const seen = new Map<string, unknown>();
  for (const v of values) {
    const h = anyhash(v, o);
    if (seen.has(h)) throw new Error(`collision: ${serialize(seen.get(h))} vs ${serialize(v)}`);
    seen.set(h, v);
  }
}

describe('api', () => {
  it('returns 32 lowercase hex characters', () => {
    expect(anyhash({ a: 1 })).toMatch(HEX32);
    expect(anyhash(undefined)).toMatch(HEX32);
  });

  it('exposes the same functions as properties and named exports', () => {
    expect(named).toBe(anyhash);
    expect(anyhash.hash).toBe(hash);
    expect(anyhash.sha256).toBe(sha256);
    expect(anyhash.serialize).toBe(serialize);
    expect(anyhash({ x: 1 })).toBe(hash({ x: 1 }));
  });

  it('is deterministic across calls', () => {
    const v = { a: [1, { b: new Map([[1, new Set([2])]]) }] };
    expect(anyhash(v)).toBe(anyhash(v));
  });

  it('rejects a non-array, non-function ignoreKeys', () => {
    expect(() => anyhash({}, { ignoreKeys: 'a' as never })).toThrow(TypeError);
  });
});

describe('primitives', () => {
  it('tells apart values that look alike', () => {
    allDistinct([
      1, '1', 1n, true, 'true', null, 'null', undefined, 'undefined', 0, -0, '0', 0n, '', ' ',
      NaN, 'NaN', Infinity, -Infinity, 'Infinity', false, 'false', [], {}, [undefined], [null], [[]], [{}],
      Symbol('a'), Symbol.for('a'), Symbol(), Symbol(''), 'Symbol("a")', -1, -1n, 1.5, 15, '1.5',
      new Number(1), new String('1'), new Boolean(true), Object(1n), Object(Symbol.for('a')),
      () => 1, function f() {}, [1, 2], [12], ['1,2'], '[1,2]', { '1': 2 }, new Map([[1, 2]]), new Set([1, 2]),
    ]);
  });

  it('distinguishes -0 from 0 and treats every NaN the same', () => {
    differ(0, -0);
    same(NaN, 0 / 0);
    same(NaN, Number('x'));
  });

  it('handles every string, including lone surrogates and quotes', () => {
    allDistinct(['', '"', '\\', '\\"', '"\\', '\ud800', '�', '\udc00', '𐀀', '😀', 'a\u0000', 'a', '\n', '\\n']);
  });

  it('hashes large BigInts by value', () => {
    same(2n ** 200n, 2n ** 200n);
    differ(2n ** 200n, 2n ** 200n + 1n);
  });

  it('hashes symbols by description, registered symbols by key', () => {
    same(Symbol('x'), Symbol('x'));
    differ(Symbol('x'), Symbol('y'));
    differ(Symbol('x'), Symbol.for('x'));
    differ(Symbol(), Symbol(''));
  });

  it('hashes functions by name and source', () => {
    same(function a(x: number) { return x; }, function a(x: number) { return x; });
    differ(function a(x: number) { return x; }, function b(x: number) { return x; });
    differ((x: number) => x, (x: number) => x + 1);
  });
});

describe('plain objects', () => {
  it('ignores key order at every level', () => {
    same({ a: 1, b: { c: 2, d: [{ e: 3, f: 4 }] } }, { b: { d: [{ f: 4, e: 3 }], c: 2 }, a: 1 });
  });

  it('ignores key order for random objects', () => {
    let seed = 1;
    const rand = () => ((seed = (Math.imul(seed, 48271) + 11) >>> 0) / 2 ** 32);
    for (let n = 0; n < 200; n++) {
      const entries = Array.from({ length: 1 + Math.floor(rand() * 40) }, (_, i) => [`k${Math.floor(rand() * 1000)}_${i}`, rand() < 0.5 ? i : { i, s: String(rand()) }] as const);
      const shuffled = [...entries].sort(() => rand() - 0.5);
      same(Object.fromEntries(entries), Object.fromEntries(shuffled));
    }
  });

  it('includes undefined values (so { a: undefined } is not {})', () => {
    differ({ a: undefined }, {});
  });

  it('treats null-prototype objects like plain objects', () => {
    same(Object.assign(Object.create(null), { a: 1 }), { a: 1 });
  });

  it('only uses own enumerable string keys', () => {
    const o = Object.create({ inherited: 1 });
    Object.defineProperty(o, 'hidden', { value: 1, enumerable: false });
    o[Symbol('s')] = 1;
    o.own = 1;
    expect(serialize(o)).toBe('{"own":1}');
  });

  it('handles a "__proto__" own key', () => {
    const o = JSON.parse('{"__proto__": {"x": 1}}');
    expect(serialize(o)).toBe('{"__proto__":{"x":1}}');
    differ(o, {});
  });

  it('cannot be confused by keys or strings that look like serialized syntax', () => {
    allDistinct([
      { a: 1, b: 2 }, { 'a":1,"b': 2 }, { a: '1,"b":2' }, { a: [1, 2] }, { 'a,b': 1 }, ['a', 1, 'b', 2],
      { a: { b: 1 } }, { 'a.b': 1 }, new Map([['a', 1], ['b', 2]]),
    ]);
  });
});

describe('arrays', () => {
  it('respects order by default', () => {
    differ([1, 2], [2, 1]);
  });

  it('ignores order with unorderedArrays, at every level', () => {
    const o = { unorderedArrays: true };
    same([1, 2, 3], [3, 1, 2], o);
    same({ a: [[1, 2], [3, 4]] }, { a: [[4, 3], [2, 1]] }, o);
    differ([1, 1, 2], [1, 2, 2], o);
    differ([1, 2], [1, 2, 2], o);
  });

  it('treats holes as undefined', () => {
    // eslint-disable-next-line no-sparse-arrays
    same([1, , 3], [1, undefined, 3]);
  });

  it('includes the class name for Array subclasses', () => {
    class List extends Array {}
    differ(List.from([1, 2]), [1, 2]);
    expect(serialize(List.from([1]))).toBe('Array:"List"[1]');
  });
});

describe('Map and Set', () => {
  it('ignore insertion order by default', () => {
    same(new Map([['a', 1], ['b', 2]]), new Map([['b', 2], ['a', 1]]));
    same(new Set([1, 2, 3]), new Set([3, 2, 1]));
    same(new Map([[{ k: 1 }, new Set(['x', 'y'])]]), new Map([[{ k: 1 }, new Set(['y', 'x'])]]));
  });

  it('respect order with unorderedMaps / unorderedSets: false', () => {
    differ(new Map([['a', 1], ['b', 2]]), new Map([['b', 2], ['a', 1]]), { unorderedMaps: false });
    differ(new Set([1, 2]), new Set([2, 1]), { unorderedSets: false });
    same(new Set([1, 2]), new Set([1, 2]), { unorderedSets: false });
  });

  it('hash keys and values of any type', () => {
    differ(new Map([[1, 'a']]), new Map([['1', 'a']]));
    differ(new Map([[1, 'a']]), new Map([[1, 'b']]));
    differ(new Map([[{ a: 1 }, 1]]), new Map([[{ a: 2 }, 1]]));
    differ(new Set([1]), new Set(['1']));
    differ(new Set([]), new Map());
  });

  it('are different from objects and arrays with the same contents', () => {
    allDistinct([new Map([['a', 1]]), { a: 1 }, [['a', 1]], new Set([['a', 1]]), new Set(['a', 1]), ['a', 1]]);
  });

  it('keep two equal-looking members of a Set', () => {
    differ(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }]));
  });

  it('include subclass names', () => {
    class Registry extends Map<unknown, unknown> {}
    class Tags extends Set<unknown> {}
    differ(new Registry([[1, 2]]), new Map([[1, 2]]));
    differ(new Tags([1]), new Set([1]));
    expect(serialize(new Tags([1]))).toBe('Set:"Tags"[1]');
  });
});

describe('Date and RegExp', () => {
  it('hash dates by time', () => {
    same(new Date(0), new Date('1970-01-01T00:00:00Z'));
    differ(new Date(0), new Date(1));
    differ(new Date(0), 0);
    differ(new Date(0), '1970-01-01T00:00:00.000Z');
    same(new Date(NaN), new Date('nope'));
  });

  it('hash regexps by source and flags', () => {
    same(/a+b/gi, new RegExp('a+b', 'ig'));
    differ(/a/g, /a/i);
    differ(/a/, /b/);
    differ(/a/, '/a/');
    differ(new RegExp('a/b'), new RegExp('a\\/b', 'g'));
    const r = /x/g;
    r.lastIndex = 5;
    same(r, /x/g);
  });
});

describe('binary data', () => {
  it('hash typed arrays by type and contents', () => {
    same(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]));
    differ(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]));
    differ(new Uint8Array([1, 2]), new Int8Array([1, 2]));
    differ(new Uint8Array([1, 2]), new Uint8ClampedArray([1, 2]));
    differ(new Uint8Array([1, 2]), [1, 2]);
    differ(new Uint16Array([1]), new Uint32Array([1]));
    differ(new Float32Array([1]), new Float64Array([1]));
    differ(new Float64Array([0]), new Float64Array([-0]));
    same(new Float64Array([NaN]), new Float64Array([NaN]));
    same(new BigInt64Array([1n, -1n]), new BigInt64Array([1n, -1n]));
    differ(new BigInt64Array([1n]), new BigUint64Array([1n]));
    expect(serialize(new Int16Array([-1, 300]))).toBe('Int16Array(-1,300)');
    expect(serialize(new Int8Array([-1, 16]))).toBe('Int8Array(ff10)');
  });

  it('only use the bytes a view can see', () => {
    const buf = new Uint8Array([9, 1, 2, 9]);
    same(buf.subarray(1, 3), new Uint8Array([1, 2]));
    same(new Uint16Array(new Uint16Array([7, 1, 2]).buffer, 2, 2), new Uint16Array([1, 2]));
    same(new DataView(buf.buffer, 1, 2), new DataView(new Uint8Array([1, 2]).buffer));
  });

  it('hash ArrayBuffer and DataView by bytes, distinct from typed arrays', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    same(bytes.buffer, new Uint8Array([1, 2, 3]).buffer);
    differ(bytes.buffer, new Uint8Array([1, 2, 4]).buffer);
    allDistinct([bytes, bytes.buffer, new DataView(bytes.buffer)]);
    expect(serialize(new DataView(bytes.buffer))).toBe('DataView(010203)');
  });

  it('include Buffer as a Uint8Array subclass', () => {
    expect(serialize(Buffer.from('hi'))).toBe('Uint8Array:"Buffer"(6869)');
    same(Buffer.from('hi'), Buffer.from([0x68, 0x69]));
  });

  it('hash SharedArrayBuffer', () => {
    const s = new SharedArrayBuffer(2);
    new Uint8Array(s).set([1, 2]);
    expect(serialize(s)).toBe('SharedArrayBuffer(0102)');
  });

  it('do not throw for detached buffers', () => {
    const ab = new ArrayBuffer(4);
    const view = new Uint8Array(ab);
    structuredClone(ab, { transfer: [ab] });
    expect(serialize(ab)).toBe('ArrayBuffer()');
    expect(serialize(view)).toBe('Uint8Array()');
  });
});

describe('errors', () => {
  const make = () => new Error('boom');

  it('ignore the stack (where the error was created)', () => {
    same(make(), new Error('boom'));
  });

  it('include class, name, message and own properties', () => {
    differ(new Error('a'), new Error('b'));
    differ(new Error('a'), new TypeError('a'));
    const coded = Object.assign(new Error('a'), { code: 'E1' });
    differ(coded, new Error('a'));
    same(coded, Object.assign(new Error('a'), { code: 'E1' }));
    expect(serialize(new RangeError('x'))).toBe('Error:"RangeError"{"message":"x","name":"RangeError"}');
  });

  it('include cause and AggregateError errors', () => {
    differ(new Error('a', { cause: 1 }), new Error('a', { cause: 2 }));
    differ(new Error('a', { cause: undefined }), new Error('a'));
    differ(new AggregateError([new Error('x')], 'm'), new AggregateError([new Error('y')], 'm'));
  });

  it('include custom error classes', () => {
    class NotFound extends Error {
      status = 404;
    }
    differ(new NotFound('x'), new Error('x'));
    expect(serialize(new NotFound('x'))).toBe('Error:"NotFound"{"message":"x","name":"Error","status":404}');
  });

  it('handle DOMException', () => {
    differ(new DOMException('a', 'AbortError'), new DOMException('a', 'TimeoutError'));
  });

  it('handle an error that is its own cause', () => {
    const e = new Error('loop');
    (e as { cause?: unknown }).cause = e;
    expect(serialize(e)).toBe('Error{"cause":Circular(0),"message":"loop","name":"Error"}');
  });
});

describe('class instances', () => {
  class Point {
    constructor(public x: number, public y: number) {}
    get len() {
      return Math.hypot(this.x, this.y);
    }
  }
  class Vec {
    constructor(public x: number, public y: number) {}
  }

  it('include the constructor name', () => {
    same(new Point(1, 2), new Point(1, 2));
    differ(new Point(1, 2), new Point(2, 1));
    differ(new Point(1, 2), new Vec(1, 2));
    differ(new Point(1, 2), { x: 1, y: 2 });
    expect(serialize(new Point(1, 2))).toBe('@"Point"{"x":1,"y":2}');
  });

  it('ignore key order and prototype getters', () => {
    const a = new Point(1, 2);
    const b = Object.create(Point.prototype);
    b.y = 2;
    b.x = 1;
    same(a, b);
  });

  it('use toJSON when a class has one (URL, Temporal, Decimal...)', () => {
    same(new URL('https://a.io/x'), new URL('https://a.io/x'));
    differ(new URL('https://a.io/x'), new URL('https://a.io/y'));
    differ(new URL('https://a.io/x'), 'https://a.io/x');
    expect(serialize(new URL('https://a.io/'))).toBe('@"URL"="https://a.io/"');
  });

  it('handle anonymous classes and objects from Object.create', () => {
    const Anon = (() => class {})();
    expect(serialize(new Anon())).toBe('@""{}');
    same(Object.create({}), {});
  });

  it('do not trust a spoofed Symbol.toStringTag', () => {
    class FakeDate {
      get [Symbol.toStringTag]() {
        return 'Date';
      }
      t = 1;
    }
    class FakeMap {
      get [Symbol.toStringTag]() {
        return 'Map';
      }
    }
    expect(serialize(new FakeDate())).toBe('@"FakeDate"{"t":1}');
    expect(serialize(new FakeMap())).toBe('@"FakeMap"{}');
  });

  it('hash boxed primitives by value and type', () => {
    same(new Number(1), new Number(1));
    differ(new Number(1), 1);
    differ(new String('a'), 'a');
    differ(new Boolean(false), new Boolean(true));
    expect(serialize([new String('a'), Object(1n), Object(Symbol.for('s'))])).toBe('[String("a"),BigInt(1n),Symbol(Symbol.for("s"))]');
  });
});

describe('values from another realm (iframes, vm, jest)', () => {
  it('hash the same as local values', () => {
    const foreign = runInNewContext(`({
      obj: { b: 1, a: [1, 2] },
      date: new Date(5),
      map: new Map([[1, new Set([2])]]),
      bytes: new Uint8Array([1, 2]),
      re: /x/g,
      err: new TypeError('t'),
      num: new Number(3),
    })`);
    same(foreign.obj, { a: [1, 2], b: 1 });
    same(foreign.date, new Date(5));
    same(foreign.map, new Map([[1, new Set([2])]]));
    same(foreign.bytes, new Uint8Array([1, 2]));
    same(foreign.re, /x/g);
    same(foreign.err, new TypeError('t'));
    same(foreign.num, new Number(3));
  });
});

describe('circular references', () => {
  it('handle self references', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(serialize(a)).toBe('{"self":Circular(0),"x":1}');
    expect(anyhash(a)).toMatch(HEX32);
  });

  it('hash identical cyclic shapes the same, and different ones differently', () => {
    const mk = (x: number) => {
      const o: Record<string, unknown> = { x, child: { y: 2 } };
      (o.child as Record<string, unknown>).parent = o;
      return o;
    };
    same(mk(1), mk(1));
    differ(mk(1), mk(2));
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    differ(a, { x: 1, self: { x: 1 } });
  });

  it('handle cycles through arrays, Maps, Sets, class instances and errors', () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(serialize(arr)).toBe('[1,Circular(0)]');

    const m = new Map<unknown, unknown>();
    m.set('me', m);
    m.set(m, 1);
    expect(serialize(m)).toBe('Map{"me"=>Circular(0),Circular(0)=>1}');

    const s = new Set<unknown>();
    s.add(s);
    expect(serialize(s)).toBe('Set[Circular(0)]');

    class Node {
      next: Node | null = null;
    }
    const n = new Node();
    n.next = n;
    expect(serialize(n)).toBe('@"Node"{"next":Circular(0)}');

    const deep = { a: { b: { c: {} as Record<string, unknown> } } };
    deep.a.b.c.up = deep.a;
    expect(serialize(deep)).toBe('{"a":{"b":{"c":{"up":Circular(1)}}}}');
  });

  it('handle cycles inside unordered arrays', () => {
    const a: unknown[] = [2, 1];
    a.push(a);
    expect(serialize(a, { unorderedArrays: true })).toBe('[1,2,Circular(0)]');
  });

  it('handle toJSON returning this', () => {
    class Weird {
      toJSON() {
        return this;
      }
    }
    expect(serialize(new Weird())).toBe('@"Weird"=Circular(0)');
  });

  it('allow the same object in several places when it is not circular', () => {
    const shared = { x: 1 };
    same({ a: shared, b: shared }, { a: { x: 1 }, b: { x: 1 } });
  });
});

describe('ignoreKeys', () => {
  it('skips keys from a list at every level', () => {
    const o = { ignoreKeys: ['updatedAt', 'id'] };
    same({ name: 'a', id: 1, nested: { updatedAt: 1, v: 2 } }, { name: 'a', id: 2, nested: { updatedAt: 9, v: 2 } }, o);
    differ({ name: 'a' }, { name: 'b' }, o);
  });

  it('skips keys chosen by a function', () => {
    const o = { ignoreKeys: (key: string, value: unknown) => key.startsWith('_') || typeof value === 'function' };
    same({ a: 1, _cache: [1], fn: () => 1 }, { a: 1, _cache: [2], fn: () => 2 }, o);
  });

  it('applies to class instances and errors but not Map keys', () => {
    const o = { ignoreKeys: ['t'] };
    class C {
      constructor(public t: number, public v = 1) {}
    }
    same(new C(1), new C(2), o);
    same(Object.assign(new Error('x'), { t: 1 }), new Error('x'), o);
    differ(new Map([['t', 1]]), new Map([['t', 2]]), o);
  });

  it('treats an empty list as no option', () => {
    expect(anyhash({ a: 1 }, { ignoreKeys: [] })).toBe(anyhash({ a: 1 }));
  });
});

describe('sha256', () => {
  it('is the SHA-256 of the UTF-8 serialization', async () => {
    const values = [{ a: 1, b: [new Date(0), new Map([['k', 1n]])] }, 'héllo 😀', undefined, new Set([1, 2])];
    for (const v of values) {
      const expected = createHash('sha256').update(serialize(v), 'utf8').digest('hex');
      expect(await sha256(v)).toBe(expected);
      expect(await anyhash.sha256(v)).toBe(expected);
    }
  });

  it('ignores key order and accepts options', async () => {
    expect(await sha256({ a: 1, b: 2 })).toBe(await sha256({ b: 2, a: 1 }));
    expect(await sha256([1, 2], { unorderedArrays: true })).toBe(await sha256([2, 1], { unorderedArrays: true }));
  });

  it('does not collide lone surrogates with the replacement character', async () => {
    expect(await sha256('\ud800')).not.toBe(await sha256('�'));
  });

  describe('without Web Crypto', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('rejects with a clear error', async () => {
      vi.stubGlobal('crypto', undefined);
      await expect(sha256(1)).rejects.toThrow(/crypto\.subtle is not available/);
    });
  });
});

describe('serialize', () => {
  it('always produces well-formed Unicode (safe to UTF-8 encode)', () => {
    const s = serialize({ '\ud800': '\udc00', k: Symbol('\ud800'), f: new Error('\udfff') });
    expect((s as unknown as { isWellFormed(): boolean }).isWellFormed()).toBe(true);
  });

  it('shows why two hashes differ', () => {
    expect(serialize({ b: new Set([2, 1]), a: [new Date(0), 1n, -0, undefined] })).toBe('{"a":[Date(0),1n,-0,undefined],"b":Set[1,2]}');
  });
});

describe('collisions', () => {
  it('has no collisions over 300,000 distinct values', () => {
    const seen = new Set<string>();
    const halves = new Set<string>();
    let count = 0;
    const add = (v: unknown) => {
      const h = anyhash(v);
      seen.add(h);
      halves.add(h.slice(0, 16)); // the first 64 bits alone should not collide at this size either
      count++;
    };
    for (let i = 0; i < 100_000; i++) add(i);
    for (let i = 0; i < 50_000; i++) add(String(i));
    for (let i = 0; i < 50_000; i++) add({ id: i });
    for (let i = 0; i < 50_000; i++) add([i >> 8, i & 255]);
    for (let i = 0; i < 25_000; i++) add(i + 0.5);
    for (let i = 0; i < 25_000; i++) add(new Uint8Array([i >> 8, i & 255]));
    expect(seen.size).toBe(count);
    expect(halves.size).toBe(count);
  });

  it('spreads bits evenly (each output bit set about half the time)', () => {
    const ones = new Array(128).fill(0);
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const h = anyhash(i);
      for (let b = 0; b < 32; b++) {
        const nib = parseInt(h[b]!, 16);
        for (let k = 0; k < 4; k++) if (nib & (1 << k)) ones[b * 4 + k]++;
      }
    }
    for (const c of ones) expect(Math.abs(c / n - 0.5)).toBeLessThan(0.02);
  });

  it('changes about half the output bits when the input changes by one character (avalanche)', () => {
    const bits = (h: string) => BigInt('0x' + h);
    let total = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const diff = bits(anyhash(`key-${i}`)) ^ bits(anyhash(`key-${i}!`));
      total += diff.toString(2).split('1').length - 1;
    }
    const avg = total / n;
    expect(avg).toBeGreaterThan(60);
    expect(avg).toBeLessThan(68);
  });
});

describe('stability (pinned values; changing these is a breaking change)', () => {
  const pinned: [string, unknown, string][] = [
    ['empty object', {}, '8fdb647686ef1967bac11d4aead2a5de'],
    ['number 1', 1, 'c1be5e0bd9baad91726daf3b4d119789'],
    ['string', 'hello', '505a0085dadbabdfce2eab04841cd08e'],
    ['nested', { b: [1, 'two', null, undefined, true], a: { c: 3n } }, 'a432a7b9f62a1ede5b09b3cc30bc2288'],
    ['map and set', new Map<unknown, unknown>([['x', new Set([3, 1, 2])], [1, new Date(0)]]), 'ece6c73ee264e8c5c780fbc51c3b943f'],
    ['binary', new Uint8Array([0, 1, 254, 255]), '46b9875c988e4fbe3012cf021b9cd5db'],
  ];

  it.each(pinned)('%s', (_name, value, expected) => {
    expect(anyhash(value)).toBe(expected);
  });

  it('pins a sha256 value', async () => {
    expect(await sha256({ b: 2, a: [1, 'x'] })).toBe('8cbd548a32262b76a6536efe4e7ba86a0e811fcd0475d83a43e10acd0615aa37');
  });

  it('pins the serialization format', () => {
    expect(serialize({ b: 2, a: [1, 'x'] })).toBe('{"a":[1,"x"],"b":2}');
    expect(serialize(new Map<unknown, unknown>([['x', new Set([3, 1, 2])], [1, new Date(0)]]))).toBe('Map{"x"=>Set[1,2,3],1=>Date(0)}');
    expect(serialize({ b: [1, 'two', null, undefined, true], a: { c: 3n } })).toBe('{"a":{"c":3n},"b":[1,"two",null,undefined,true]}');
    expect(serialize([Symbol('s'), Symbol.for('r'), Symbol(), NaN, -Infinity, 1e21, /a/g])).toBe(
      '[Symbol("s"),Symbol.for("r"),Symbol(),NaN,-Infinity,1e+21,RegExp("/a/g")]',
    );
  });
});
