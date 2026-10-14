# Mobile npm audit (`npm audit --omit=dev`)

Before: 22 vulnerabilities (7 moderate, 15 high). After: **15 (0 moderate, 15 high)**.

## Fixed

`uuid@7.0.3` (moderate, GHSA-w5hq-g745-h8pq, missing bounds check) — the only consumer in the
tree is `xcode@3.0.1` (`@expo/config-plugins` → `xcode`), which calls `require('uuid').v4()`.
Pinned via `mobile/package.json` `overrides`:

```json
"overrides": { "uuid": "^11.1.1" }
```

Verified before applying: `xcode@3.0.1`'s only usage is `uuid.v4()` in `lib/pbxProject.js`.
Verified after installing: `uuid@11.1.1` still exposes both `require('uuid').v4()` and
`const { v4 } = require('uuid')`, and `require('xcode')` still loads and exposes `xcode.project`.
This also resolved the `xcode`/`@expo/config-plugins` moderate advisories that were only present
*because* of the vulnerable `uuid` version (7 moderate findings total, all transitively from this
one package).

## Not fixed — no patched version exists yet

- **`braces@3.0.3`** (high, GHSA-vfj7-8cjw-p6xm, stack-exhaustion DoS) — `3.0.3` is the latest
  version published to npm. There is no newer `braces` release to move to.
- **`node-forge@1.4.0`** (high, GHSA-86w9-cpqp-85rv, PKCS#1 v1.5 signature verification accepts
  extra nested DigestAlgorithm elements) — `1.4.0` is the latest version published to npm.

Both are pulled in transitively through Expo/Metro build tooling (`@expo/metro` → `metro-file-map`
→ `micromatch` → `braces`; `@expo/cli` → `@expo/code-signing-certificates` → `node-forge`) and are
only reachable at **build/dev-server time** (Metro's file-watcher glob matching, EAS code-signing
cert parsing) — neither ships inside the compiled app bundle that runs on a user's device.
`npm audit`'s only proposed fix for these is downgrading `expo` to `44.0.6`
(`isSemVerMajor: true`), which was explicitly ruled out. No `overrides` entry was added for these
because there is no higher patched version to override *to* — overriding to the same vulnerable
version would be a no-op.

**Residual risk**: low but non-zero, scoped to local dev/CI build tooling, not the shipped app.
Re-run `npm audit --omit=dev` periodically (or re-run after any `expo`/Metro upgrade) — once
upstream publishes a patched `braces` or `node-forge`, npm will pick it up automatically via the
existing transitive dependency, no further action needed here unless the new version requires its
own override.

## Verification run after the change

| Check | Result |
|---|---|
| `npm install` (regenerate lockfile with the override) | PASS — `uuid@11.1.1` resolved, `xcode` loads |
| `npm run typecheck` | PASS |
| `npm run test` | PASS — 8/8 |
| `npx expo-doctor` | PASS — 21/21 |
| `npm audit --omit=dev` | 22 → 15 (0 moderate, 15 high remaining, all unfixable upstream today) |

Not run: `npm audit fix --force` (explicitly excluded — proposes `expo@44.0.6`), full
`npm audit` including devDependencies (task scoped this to production deps only).
