# anyhash

A stable hash for any JavaScript value. The same data always gives the same hash, whatever the key order.

[![npm version](https://img.shields.io/npm/v/anyhash.svg)](https://www.npmjs.com/package/anyhash) [![bundle size](https://img.shields.io/bundlephobia/minzip/anyhash)](https://bundlephobia.com/package/anyhash) [![license](https://img.shields.io/npm/l/anyhash.svg)](LICENSE)

A hash is a short string made from your data, like a fingerprint. `anyhash` gives a **stable** hash: it depends only on the data, so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` get the same hash, in every run and on every machine. Use it for cache keys, to find duplicates, or to check if data has changed. It can replace `object-hash`.

## Features

- **Any value**: objects, arrays, `Map`, `Set`, `Date`, `RegExp`, typed arrays, `ArrayBuffer`, `DataView`, `Error`, class instances, symbols, BigInt and circular references.
- **Exact about types**: `1`, `'1'` and `1n` hash differently, and so do `0` / `-0`, `null` / `undefined`, `{ a: 1 }` / `new Map([['a', 1]])`.
- **Order does not matter** for object keys, and by default for `Map` and `Set` entries. Arrays can ignore order too, with an option.
- **Fast**: a 128-bit MurmurHash3 hash. Synchronous, no `crypto` needed.
- **SHA-256** through Web Crypto, when you need a cryptographic hash.
- **Easy to debug**: `serialize()` shows the text behind a hash, so you can see why two hashes differ.
- **Stable across versions**: hash values are pinned in the tests and only change in a new major version.
- **Zero dependencies**, ESM and CommonJS, TypeScript types included. Works in Node.js 20+, Bun, Deno, browsers and edge runtimes.

## Installation

```sh
npm install anyhash
```

```sh
pnpm add anyhash
yarn add anyhash
bun add anyhash
```

## Quick start

```js
import anyhash from 'anyhash'

// Same data in a different key order: same hash
anyhash({ a: 1, b: [2, 3] })   // => 'e27fd6f02f9e19bec054683a3adce1a6'
anyhash({ b: [2, 3], a: 1 })   // => 'e27fd6f02f9e19bec054683a3adce1a6'

// Different types: different hash
anyhash(1) === anyhash('1')    // => false

// Map, Set, Date, typed arrays, class instances, circular references...
anyhash(new Map([['k', new Set([1, 2])]]))   // => 'cb0b1e0363546f0e57134a71306a8898'

// SHA-256, when the hash must be cryptographic
await anyhash.sha256({ a: 1, b: [2, 3] })
// => 'efbd0040190fb0871831e606c581f8a66db79d8e2bb836745a70051306956070'

// The text that was hashed, to see why two hashes differ
anyhash.serialize({ b: 1, a: new Date(0) })  // => '{"a":Date(0),"b":1}'
```

With CommonJS, use `const anyhash = require('anyhash')` or `const { hash, sha256, serialize } = require('anyhash')`.

## Table of contents

- [Usage](#usage)
- [API](#api)
- [Comparison](#comparison)
- [Notes and limitations](#notes-and-limitations)
- [Requirements](#requirements)
- [License](#license)

## Usage

### Make a cache key from an object

Objects with the same data get the same hash, even when the keys are in a different order. So the hash works well as a key for a `Map`, Redis or any other cache.

```js
import anyhash from 'anyhash'

const cache = new Map()

async function search(filters) {
  const key = anyhash(filters)
  if (!cache.has(key)) cache.set(key, await runSearch(filters))
  return cache.get(key)
}

anyhash({ city: 'Paris', page: 1 }) === anyhash({ page: 1, city: 'Paris' })   // => true
```

### Check if data has changed

Save the hash, and compare it later. If any value changed, at any level, the hash is different.

```js
import anyhash from 'anyhash'

const user = { name: 'Ann', address: { city: 'Paris' } }
const before = anyhash(user)

user.address.city = 'Lyon'
anyhash(user) === before   // => false
```

### Choose between the fast hash and SHA-256

`anyhash()` and `anyhash.sha256()` hash the same text (see [`serialize()`](#anyhashserializevalue-options)). They differ in the hash function used on that text.

| | `anyhash(value)` | `anyhash.sha256(value)` |
|---|---|---|
| Result | 32 hex characters (128 bits) | 64 hex characters (256 bits) |
| Returns | A string (synchronous) | A `Promise` of a string |
| Hash function | MurmurHash3, fast and not cryptographic | SHA-256, cryptographic |
| Can other tools check it? | Only with the exact algorithm described in [How the hash is computed](#how-the-hash-is-computed) | Yes, any SHA-256 tool, from `serialize(value)` |

**Use `anyhash()`** for cache keys, finding duplicates and detecting changes, when the data comes from your own code. Accidental collisions (two different values with the same hash) are practically impossible: you would need around 2^64 different values before two are likely to share a hash.

**Use `anyhash.sha256()`** when someone could choose the input on purpose to make two values share a hash, for example with data from users. A cryptographic hash is built so that nobody can find such pairs. Also use it when another system needs to check the hash with a standard SHA-256 tool.

**Do not use either for passwords.** Both are fast on purpose, so an attacker can also guess passwords fast. Use a password hashing function instead, such as `scrypt` from `node:crypto`, bcrypt or Argon2. Also, a hash is not a secret or a signature: anyone with the same data can compute the same hash.

### Ignore some keys

Use `ignoreKeys` to leave out keys that should not change the hash, like timestamps or database IDs. Keys are ignored at every level of the value.

```js
import anyhash from 'anyhash'

const a = { id: 1, name: 'Ann', updatedAt: '2026-01-01' }
const b = { id: 1, name: 'Ann', updatedAt: '2026-05-12' }
const options = { ignoreKeys: ['updatedAt'] }

anyhash(a) === anyhash(b)                     // => false
anyhash(a, options) === anyhash(b, options)   // => true
```

You can also pass a function `(key, value) => boolean`. Return `true` for keys to skip:

```js
const skipPrivate = { ignoreKeys: (key) => key.startsWith('_') }

anyhash({ id: 1, _rev: '3-a1' }, skipPrivate) === anyhash({ id: 1 })   // => true
```

`ignoreKeys` applies to the properties of objects, class instances and `Error`s. It does not apply to `Map` keys.

### Ignore array order

By default, the order of array items counts. With `unorderedArrays: true`, `[1, 2]` and `[2, 1]` hash the same. This applies to every array in the value.

```js
import anyhash from 'anyhash'

const options = { unorderedArrays: true }

anyhash(['red', 'blue']) === anyhash(['blue', 'red'])                     // => false
anyhash(['red', 'blue'], options) === anyhash(['blue', 'red'], options)   // => true
```

### Make Map and Set order count

By default, the insertion order of `Map` and `Set` entries does not count. Set `unorderedMaps: false` or `unorderedSets: false` to make it count.

```js
import anyhash from 'anyhash'

const a = new Set(['x', 'y'])
const b = new Set(['y', 'x'])
const options = { unorderedSets: false }

anyhash(a) === anyhash(b)                     // => true
anyhash(a, options) === anyhash(b, options)   // => false
```

### Find out why two hashes differ

`serialize()` returns the canonical string: one fixed text form of the value, which is what gets hashed. Two values hash the same exactly when their canonical strings are the same. Compare the strings to see the difference.

```js
import anyhash from 'anyhash'

anyhash.serialize({ name: 'Ada', tags: new Set(['b', 'a']), joined: new Date(0) })
// => '{"joined":Date(0),"name":"Ada","tags":Set["a","b"]}'

class User {
  constructor() {
    this.id = 1
    this.name = 'Ada'
  }
}
anyhash.serialize(new User())   // => '@"User"{"id":1,"name":"Ada"}'
```

The format is made for reading and comparing. It is not meant to be parsed back into a value.

### Check a SHA-256 hash with another tool

`anyhash.sha256(value)` is the SHA-256 of the UTF-8 bytes of `serialize(value)`. So any SHA-256 tool gives the same result:

```js
import anyhash from 'anyhash'
import { createHash } from 'node:crypto'

const value = { a: 1, b: [2, 3] }
const ours = await anyhash.sha256(value)
const theirs = createHash('sha256').update(anyhash.serialize(value)).digest('hex')

ours === theirs   // => true
```

```sh
printf '%s' '{"a":1,"b":[2,3]}' | sha256sum
# efbd0040190fb0871831e606c581f8a66db79d8e2bb836745a70051306956070  -
```

### Know what counts as the same value

Two values hash the same exactly when `serialize()` gives the same string for both. This table shows what is used for each kind of value:

| Value | Hashed by |
|---|---|
| Strings, numbers, booleans, BigInt, `null`, `undefined` | Type and value. `-0` differs from `0`. Every `NaN` is the same. |
| Plain objects | Own enumerable string keys, in any order. `{ a: undefined }` differs from `{}`. Objects with a `null` prototype count as plain objects. |
| Arrays | Items in order (any order with `unorderedArrays`). Holes count as `undefined`. |
| `Map` / `Set` | Entries in any order (insertion order with `unorderedMaps: false` / `unorderedSets: false`). |
| `Date` | The timestamp. All invalid dates are the same. |
| `RegExp` | Source and flags (not `lastIndex`). |
| Typed arrays, `ArrayBuffer`, `DataView` | Type and the bytes or items they show. A `subarray` hashes like a copy. |
| `Error` | Class, `name`, `message`, own enumerable properties (like `code`), `cause`, and `errors` for `AggregateError`. Not the stack trace. |
| Class instances | Constructor name plus own enumerable properties. If the class has `toJSON()`, its result is used instead, so `URL`, `Temporal` and decimal types hash by value. |
| Boxed primitives (`new Number(1)`) | Type and value. Different from the plain primitive. |
| Symbols | Description. `Symbol.for()` symbols by key. |
| Functions | Name and source code. |
| Circular references | Position in the structure, so circular structures with the same shape hash the same. |

Subclasses keep their name: a `class Tags extends Set` hashes differently from a `Set`, and a `Buffer` differently from a `Uint8Array`.

Values from another realm hash the same as local ones. A realm is a separate JavaScript global environment, such as an iframe, a `vm` context or Jest's test environment.

## API

### anyhash(value, options?)

```ts
function anyhash(value: unknown, options?: AnyhashOptions): string
```

Returns a 32-character hex string: a 128-bit MurmurHash3 hash. It is synchronous and fast, but not cryptographic. Use [`sha256`](#anyhashsha256value-options) if someone could choose inputs to make hashes collide on purpose.

This is the default export. `anyhash.hash` and the named export `hash` are the same function. Takes the [options](#options) below.

### anyhash.sha256(value, options?)

```ts
function sha256(value: unknown, options?: AnyhashOptions): Promise<string>
```

Returns a `Promise` of a 64-character hex SHA-256 hash. It is the SHA-256 of the UTF-8 bytes of `serialize(value)`, computed with Web Crypto (`crypto.subtle`). Also available as the named export `sha256`.

Web Crypto exists in Node.js 20+, Bun, Deno, edge runtimes and browsers. In browsers it works only on secure pages (HTTPS or `localhost`). Without it, the promise rejects with an `Error`.

### anyhash.serialize(value, options?)

```ts
function serialize(value: unknown, options?: AnyhashOptions): string
```

Returns the canonical string that both hashes are computed from. Use it to see why two values hash differently. See [Find out why two hashes differ](#find-out-why-two-hashes-differ). Also available as the named export `serialize`.

### Options

All three functions take the same options (type `AnyhashOptions`).

| Option | Type | Default | Description |
|---|---|---|---|
| `ignoreKeys` | `readonly string[] \| ((key: string, value: unknown) => boolean)` | none | Keys to leave out, at every level. A list of names, or a function that returns `true` for keys to skip. Applies to object, class instance and `Error` properties, not to `Map` keys. Any other type throws a `TypeError`. |
| `unorderedArrays` | `boolean` | `false` | Ignore the order of array items, so `[1, 2]` and `[2, 1]` hash the same. |
| `unorderedSets` | `boolean` | `true` | Ignore the insertion order of `Set` entries. `false` makes the order count. |
| `unorderedMaps` | `boolean` | `true` | Ignore the insertion order of `Map` entries. `false` makes the order count. |

### Exports

```ts
import anyhash, { hash, sha256, serialize, type AnyhashOptions } from 'anyhash'
```

The named export `anyhash` is the same as the default export.

### How the hash is computed

`anyhash(value)` is MurmurHash3 x86 128-bit, seed 0, of the UTF-16LE bytes of `'anyhash1' + serialize(value)`. The result is the four 32-bit words `h1 h2 h3 h4`, written in hex. The tests check the implementation against the SMHasher verification value of the reference algorithm.

`anyhash.sha256(value)` is SHA-256 of the UTF-8 bytes of `serialize(value)`, with no prefix.

## Comparison

| | `object-hash` | **anyhash** |
|---|---|---|
| Ignores object key order | Yes | Yes |
| Map, Set, typed arrays, circular references | Yes | Yes |
| Fast non-cryptographic hash | No (SHA-1 by default) | Yes, 128-bit MurmurHash3 |
| SHA-256 | Yes, with Node's `crypto` | Yes, with Web Crypto, so it also works in browsers and edge runtimes |
| See the data behind a hash | `algorithm: 'passthrough'` | `serialize()` |
| TypeScript types | No (needs `@types/object-hash`) | Yes, built in |
| ESM and CommonJS | No (CommonJS only) | Yes |

## Notes and limitations

- **`anyhash()` is not cryptographic.** Use `anyhash.sha256()` for input that someone could choose on purpose. Use neither for passwords.
- **Some properties are not included**: symbol keys, non-enumerable properties, private class fields (`#x`) and getters on the prototype.
- **`WeakMap`, `WeakSet`, `WeakRef` and `Promise` cannot be read**, so they hash by class name only. All `WeakMap`s hash the same.
- **Shared objects are hashed in full each time.** If the same object appears in several places, it is hashed at each place, like `JSON.stringify` does.
- **Functions hash by name and source code**, so two functions with the same name and code hash the same.
- **`serialize()` output is for reading**, not for parsing back into a value.
- **`anyhash.sha256()` needs Web Crypto.** In browsers, that means a secure page (HTTPS or `localhost`).
- **Hash values only change in a new major version.**

## Requirements

- Node.js 20 or newer. Also works in Bun, Deno, browsers and edge runtimes.
- ESM and CommonJS.
- TypeScript types included.
- Zero dependencies.

## License

MIT
