# Changelog

## 1.2.0 (2026-11-08)

First stable TypeScript release.

### Breaking changes
- The package no longer ships plain JS source (`lib/`). Everything compiles to ESM JavaScript with `.d.ts` typings under `dist/`; `main`/`exports`/`types`/`bin` all point there.
- Node.js >= 18 required (ESM, global fetch).
- `postinstall` no longer runs the Maven build of the Java port — instead, opt in via `npm run build:java`. Without a jar on disk the Java adapter throws a clear ENOENT.

### Features
- Full TypeScript conversion with \`noUncheckedIndexedAccess\` strict mode.
- Typed exports per subpath: '.', './recorder', './verifier', './transformer', './daemon', './constants', './config', './logger'.
- `isomorphic` detection of recording target languages (js/java) for the whole `record/stop/test/clean/inject` CLI surface.
- Golden roundtrip test suite (`tests/golden-roundtrip.test.ts`) drives the real CLI in ephemeral fixture dirs, asserting byte-exact restore, snapshot capture, drift detection (exit code 1), pid file lifecycle.
- The inline recorder injected into Node apps is now isomorphic (window / globalThis / self) and honors the daemon port the CLI actually uses.
- `verifier` compares primitive results directly (microdiff is object-root only).

### Bug fixes from the golden suite
- Daemon now respects IOSNAP_DAEMON_PORT (arg > env > config > default).
- Fixed the CLI swallowing error details on daemon HTTP failures (now includes errno + message).
- Fixed the CLI interpolating a stale daemon port into the inline recorder at inject time.
- Fixed the sync/async return-semantics mismatch of the proxy-wrapped function under test.

### Internal
- CI workflow: typecheck + build + vitest + pack surface gate on push/PR to publish-prep.
