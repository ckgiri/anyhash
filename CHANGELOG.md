# Changelog

All notable changes to this package are documented here. This project follows [Semantic Versioning](https://semver.org/).

Hash values only change in a new major version.

## 1.1.0 - Unreleased

Documentation only. No code or behavior changes.

- Rewrote the README: plain wording, a full API reference with options tables, and examples that are checked against the build.
- Fixed type doc comments shown in editors: the `Map` example now shows the real hash.

## 1.0.0 - 2026-11-24

First release.

- `anyhash(value, options?)`: fast, stable 128-bit hash (MurmurHash3 x86 128) of any value, as 32 hex characters.
- `anyhash.sha256(value, options?)`: SHA-256 of the same canonical form via Web Crypto, as a Promise of 64 hex characters.
- `anyhash.serialize(value, options?)`: the canonical string that gets hashed, to see why two hashes differ.
- Supports primitives (`1`, `'1'` and `1n` all differ, as do `0` and `-0`, `null` and `undefined`), plain objects in any key order, arrays, `Date`, `RegExp`, `Map`, `Set`, typed arrays, `ArrayBuffer`, `DataView`, `Error` (with `cause`), boxed primitives, symbols, functions, class instances (by constructor name and own properties, or `toJSON` for classes like `URL`) and circular references.
- Works with values from other realms (iframes, `vm`, Jest).
- Options: `ignoreKeys` (list or function), `unorderedArrays`, `unorderedSets`, `unorderedMaps`.
- ESM + CommonJS, types included, zero dependencies.
