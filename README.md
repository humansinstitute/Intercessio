# Intercessio

Self-hosted remote signing bunker for Nostr. Built for macOS today (keys live in Secure Keychain; PRs welcome for other platforms).

Unique aspects:
- Keychain security
- Policy enforcement (“vibe your own”): simple TypeScript functions decide what to sign
- Coming soon: approvals via multiple channels

## Quick start (Bun)

Prereqs: Bun v1.3+, macOS. The project points to the local [applesauce](https://github.com/hzrd149/applesauce) monorepo via `file:` dependencies; keep that repo adjacent or swap to published packages when available.

```bash
bun install

# start signing server + web UI together
bun run stack           # web UI: http://localhost:4173 (override INTERCESSIO_WEBUI_PORT)

# or run separately
bun run server          # signing daemon
bun run webui           # dashboard
```

## What it does

- Stores secrets in macOS Keychain; metadata in `~/.intercessio/keys.json` and SQLite.
- Lets you generate/import keys, start bunker/nostr-connect sessions, and monitor activity from the browser.
- Enforces signing policies via simple TypeScript functions (“vibe your own”).
- (Coming soon) approvals over additional channels.
