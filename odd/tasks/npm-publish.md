# io-snapshot — industry-standard npm publish

@kendroger/io-snapshot · scoped name · TS rewrite first · golden roundtrip vitest suite.

## Specs

- **S1** Publish `@kendroger/io-snapshot` to the npm registry. (owner: "I want to publish it with complete proper code that is of industry standard")
- **S2** The published source is **TypeScript** (owner chose "TS rewrite FIRST" — honors the deferred S10). JS-era lib/ is converted; no mixed JS/TS shipping surface.
- **S3** Golden **roundtrip test suite** (owner chose "golden"): record → stop → test on a sample repo; asserts snapshots written, restore is clean, verifier reports drift correctly.
- **Q3/Q24** Scoped `@kendroger/io-snapshot` only; no unscoped tombstone reuse; registry-404 today (never published). README must not overclaim until publish succeeds, then the npm badge may return.
- **Q1** Integration branch `publish-prep` FROM `origin/main` (d63b35a) with java-implementation merged in (owner's WIP feat(lib) commit 128c055 included).
- **Baseline safety rules carried over:** zero data loss in the record/test cycle; restore must be byte-clean; respect "no npm claims until actually published."

## Tasks

| id | S | route | commit |
|----|---|-------|--------|
| T1 | S1+S2 | Create `publish-prep`, merge java-implementation | d720169 |
| T2 | S2 | TS conversion batch A: `lib/core/*` (config, constants, daemon, logger, paths, recorder, verifier) → `src/` with tsconfig strict | — |
| T3 | S2 | TS conversion batch B: `lib/adapter/{js,java}`, `bin/cli.js` → TS; single CLI entry | — |
| T4 | S2 | build pipeline: tsup/tsc emit → `dist/`; `exports`/`main`/`bin` retargeted; `files` allowlist | — |
| T5 | S3 | vitest golden roundtrip suite (sample fixture repo shipped in `test/`) | — |
| T6 | S1 | `.github/workflows/ci.yml` (build + test + `npm pack --dry-run` gate) | — |
| T7 | S1 | package hygiene: `prepublishOnly`, `engines`, `types`, repo/license/keywords final pass; CHANGELOG.md; version policy from 1.2.0 | — |
| T8 | S1 | README final pass (honest install, badge AFTER publish), docs | — |
| T9 | S1 | `npm publish --dry-run` clean → real publish → smoke `npx @kendroger/io-snapshot` → resume-fact fallback | — |

## Log

- **L1** Owner request verbatim: "For io-snapshot, I want to publish it with complete proper code that is of industry standard." Earlier decisions honored: S10 TS-first, scoped package, golden tests.
- **L2** Baseline facts (verified this session): integration branch created `publish-prep` (from origin/main d63b35a + merged java-implementation → owner's WIP now committed as 128c055), merge d720169; package lands at **1.2.0** scoped; `npm install` BREAKS on postinstall (`build:java` → Maven compile failure: `Factory.createPrettyPrinter()` cannot-find-symbol + CtTypeReference capture-covariance in IOSnapshotProcessor.java:64/166; Maven 3.9.12 present, so it's code-gen breakage in the user's WIP, not tooling); current `vitest run` = 0 tests; main's README install section still overclaims `npx @kendroger/io-snapshot`; remote-main README (d63b35a) already badge-less.
- **L3** Scoping answers (owner, one batched ask): Q1 fresh-branch-from-main ✓(d720169) · Q2 TS-first · Q3 scoped pkg · Q4 golden suite. This file is the handoff contract; TS conversion starts T2 next session with clean grounds.
