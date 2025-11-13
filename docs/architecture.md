# Architecture Overview

This document explains how `Intercessio` is organized so future changes can target the right component quickly.

## High-level pieces

| Component | Responsibility |
|-----------|----------------|
| CLI client (`src/index.ts`, `src/api/*`) | Interactive experience: key management, prompting for relays/secrets, sending instructions to the server via IPC |
| Signing server (`src/server.ts`) | Long-lived daemon that keeps `NostrConnectProvider` instances alive, signs events, and restores state on restart |
| Key store (`src/api/key-store.ts`) | Tracks key metadata (`keys.json` + `state.json`) and stores secrets in macOS Keychain |
| Session store (`~/.intercessio/intercessio.db`) | SQLite database (via Bun's built-in `bun:sqlite`) containing all bunker / nostrconnect sessions, aliases, relay lists, and status |
| IPC (`src/api/ipc.ts`) | Defines the JSON protocol used between client and server over the Unix socket `~/.intercessio/intercessio.sock` |

## Data flow

1. **User runs the client** (`bun run client`, `intercessio bunker`, etc.).
2. The client reads available keys from `keys.json` and Keychain, prompts for relays/alias, and sends a typed IPC request to the server (e.g., `start-bunker`).
3. The server loads the requested key from Keychain, starts a `NostrConnectProvider` with `applesauce-signers`, stores/updates the session in SQLite, and responds with metadata (session id, bunker URI, etc.).
4. From this point the server alone maintains the connection; the CLI can exit. Remote apps send requests via nostr relays, the provider signs using the selected key, and the server updates session status (`waiting` → `connected`, last client pubkey, timestamps).
5. On restart, the server loads every active session from SQLite (`active = 1`) and spins up providers so they continue listening automatically.

## Files and responsibilities

### CLI (`src/index.ts`)

- Provides the top-level `commander` program.
- Offers commands for:
  - `keygen` / `keygen --import`
  - `bunker`, `nostr-connect`
  - `sessions list|stop|delete|rename`
  - `relays`, `status`, `server`
- Uses helpers from `src/api/flows.ts` for interactive bunker / nostrconnect flows and `src/api/server-control.ts` to ensure the server is up before sending IPC requests.

### Signing server (`src/server.ts`)

- Runs as a Bun process that:
  - Ensures only one instance is listening on the Unix socket.
  - Restores all active sessions from SQLite by re-creating `NostrConnectProvider`s.
  - Handles IPC commands: start/stop/delete session, rename session, list sessions, ping, shutdown.
  - Persists bunker URIs, nostrconnect URIs, relay lists, alias, and status updates back to the DB.
- Each runtime session holds:
  - `record`: persisted metadata (`SessionRecord` from `src/api/db.ts`).
  - `provider`: the running `NostrConnectProvider`.
  - When a client connects, the server updates `last_client`, `status`, and logs activity.

### Storage

- **Keys**:
- `~/.intercessio/keys.json`: array of `KeyMetadata` (id, label, npub, Keychain account, storage type).
- `~/.intercessio/state.json`: the currently active key ID.
- Key secrets are never written to disk; they are stored as macOS Keychain generic-password entries (service `intercessio`, account `intercessio-<id>`).
- **Sessions** (`src/api/db.ts`):
  - SQLite file `~/.intercessio/intercessio.db` with `sessions` table containing id, type (`bunker` / `nostr-connect`), key id, alias, relays (JSON), secret (for bunker), URI (for nostrconnect), auto-approve flag, status, timestamps, and `active` flag.
  - Helper functions provide CRUD operations used by both server and CLI (list sessions, rename, deactivate/delete).

### IPC protocol

Defined in `src/api/ipc.ts` as TypeScript discriminated unions. Key request types:

- `start-bunker` (keyId, alias, relays, secret?, autoApprove)
- `start-nostr-connect` (keyId, alias, relays, uri, autoApprove)
- `list-sessions` / `stop-session` / `delete-session` / `rename-session`
- `ping` / `shutdown`

Responses are `{ ok: true, ... }` or `{ ok: false, error }`. The client uses `sendIPCRequest` to open the Unix socket, write JSON + newline, then wait for the newline-terminated JSON response.

## Key signing path

1. The server fetches the active key via `getKeyRecordById`, which reads metadata and loads the secret from Keychain.
2. It constructs a `SimpleSigner` (`applesauce-signers`) and passes it to `buildProvider` (`src/api/provider.ts`) along with callbacks for auto-approving operations.
3. The provider subscribes to the configured relays (through `applesauce-relay`), responds to nostrconnect requests, and calls the signer for `sign_event`, `nip04_*`, `nip44_*`.
4. Because the server owns the providers, events continue to be signed even after the CLI exits.

## Session lifecycle

```
client request ---> server creates SessionRecord ---> runtime provider starts
                                           |
                                           v
                               status persisted to SQLite
```

- Stopping a session via CLI sets `active = 0` and shuts down the provider.
- Deleting removes the row entirely.
- Server shutdown stops all runtime providers and leaves metadata intact; on restart, only rows with `active = 1` are brought back.

## CLI-to-server commands summary

| Command | Effect |
|---------|--------|
| `intercessio bunker` / `intercessio nostr-connect` | Prompts for data, sends `start-*` IPC request, prints session info |
| `intercessio sessions list` | Sends `list-sessions`, prints each record |
| `intercessio sessions stop <id>` | Sends `stop-session`, leaves metadata |
| `intercessio sessions delete <id>` | Sends `delete-session`, removes metadata |
| `intercessio sessions rename <id> <alias>` | Sends `rename-session`, updates DB |
| `bun run stop` | Sends `shutdown`, server terminates gracefully |

With this layout, future changes can target a specific layer:

- New storage backends → adjust `src/api/db.ts` and server restore logic.
- New key storage scheme → extend `src/api/key-store.ts` and provider construction.
- Extra CLI features → add subcommands calling `sendIPCRequest`.
