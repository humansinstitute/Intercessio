# Intercessio

A minimal Nostr signer CLI built on top of the [applesauce](https://github.com/hzrd149/applesauce) libraries. It can:

- Generate and persist a local private key (`nsec`)
- Respond to `nostrconnect://` URIs so you can log into remote apps
- Spin up a `bunker://` provider that remote apps can pair with via QR/code

## Prerequisites

- Node.js 18+
- Access to the local `applesauce` monorepo (already referenced as a file dependency)

## Install & build (Bun)

```bash
bun install
bun run dev -- keygen   # runs TypeScript directly via Bun
bun run dev -- nostr-connect

# build the distributable CLI
bun run build

# scripted setup (install + typecheck + build)
bun run setup

# start the signing server in a dedicated terminal
intercessio server           # or: bun run server

# in another terminal, run the interactive CLI menu
bun run start             # or: bun run client

# or pass a subcommand through the setup runner
bun run start -- nostr-connect

# when done, stop the server
bun run stop
```

## Key management

```bash
# Generate a key (secret stored in macOS Keychain)
intercessio keygen

# Import an existing key (nsec or hex)
intercessio keygen --import

# List keys and see which one is active
intercessio status
```

> Tip: `intercessio status` marks the active key with `*` and shows `[Keychain]` vs `[Secure Enclave]` (future upgrade).

## Connecting to remote apps

**Nostr Connect flow**

From the interactive launcher (`bun start`) pick **Log in via Nostr Connect** to queue a session with the background server, or run the subcommand directly and follow the prompts. Flags simply pre-fill the answers:

```bash
intercessio nostr-connect \
  --uri "nostrconnect://..." \
  --relay wss://relay.nsec.app wss://nos.lol
```

- Always asks for the URI (pre-populated when `--uri` is supplied)
- Prompts for relay list and whether to auto-approve requests (`--auto-approve` skips the question)
- Uses the same prompt session for runtime approvals (connect/sign/encrypt/decrypt)

**Bunker flow**

From the launcher choose **Manage connections → Generate bunker code** (auto-approves every request by default) or run the subcommand directly:

```bash
intercessio bunker
```

Either path will guide you through the relay list and shared secret (blank to auto-generate). Flags like `--relay`, `--secret`, and `--auto-approve` still act as defaults.

## Background server

- `intercessio server` must run in its own terminal window. It listens on `~/.intercessio/intercessio.sock` and stays alive until you stop it.
- Client commands (`bunker`, `nostr-connect`, or the interactive menu) just send instructions over IPC; the server holds the `NostrConnectProvider` connections so you can close the client.
- Use `intercessio relays` to inspect defaults, `intercessio status` to pick the active key, then `bun start` → option 1/2 to queue sessions. The server logs when clients connect/disconnect.
- If the client cannot reach the server it will exit with: “Signing server is not running. Start it in another terminal with `intercessio server`.”
- Sessions are persisted in `~/.intercessio/intercessio.db` so that a restart resumes all bunker/nostrconnect listeners automatically.

## Managing sessions

Use the new `sessions` command group to inspect and maintain long-running connections:

```bash
intercessio sessions list             # show all bunker + nostrconnect sessions
intercessio sessions stop <id>        # stop a session but keep metadata
intercessio sessions delete <id>      # stop and remove it entirely
intercessio sessions rename <id> "My App"
```

Aliases are prompted for when you create sessions so you can easily identify them later.

> Tip: In the interactive launcher (`bun run start`), pick **Manage connections** to access bunker generation, bunker-code inspection, and session management actions without remembering individual subcommands.

## Inspecting bunker codes

To see every bunker URI Intercessio is currently advertising (and the relays each session watches), run:

```bash
intercessio bunker-codes
```

This command queries the server, lists all bunker sessions (active or stopped), and prints their IDs, aliases, relays, URIs, and last-connected client info when available.

## Web UI

Prefer a browser instead of the CLI? Launch the lightweight dashboard:

```bash
bun run webui
```

By default it serves on `http://localhost:4173` (override with `INTERCESSIO_WEBUI_PORT`). The page lets you:

- generate or import keys and pick the active key
- request bunker sessions (with automatic shared-secret generation if you leave it blank)
- inspect every session the signing server knows about
- watch recent signing / connect activity streamed from the server

The web UI talks to the same Unix-socket API as the CLI, so make sure `intercessio server` is already running in another terminal.

## Relays

List the baked-in relays:

```bash
intercessio relays
```

Pass one or more `--relay` values to override the defaults for any command.

## Notes

- Private keys are saved as macOS Keychain generic-password entries (service `intercessio`). Only labels/npubs/timestamps live in `~/.intercessio/keys.json`.
- The currently active key ID is tracked in `~/.intercessio/state.json`; run `bun start` to switch without overwriting older keys.
- All signing is handled by `applesauce-signers.SimpleSigner` and `NostrConnectProvider`.
- Relay I/O flows through `applesauce-relay`'s `RelayPool`.
