#!/usr/bin/env bun

import { $ } from "bun";

console.log("🔧 Installing dependencies...");
await $`bun install`;

console.log("🧪 Type-checking...");
await $`bun run typecheck`;

console.log("📦 Building CLI...");
await $`bun run build`;

console.log("✅ Setup complete");
