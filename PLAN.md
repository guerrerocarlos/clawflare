# Clawflare Plan

## Purpose

Build a Cloudflare-native assistant platform inspired by OpenClaw and NemoClaw, but designed around Workers isolates, Durable Objects, Dynamic Workers, Workflows, Queues, and optional Cloudflare Containers instead of assuming a long-lived server with host shell access.

This plan is based on local inspection of:

- `../openclaw`
- `../NemoClaw` (the requested `../nemoclaw` path is actually uppercase on disk)

It also uses current Cloudflare docs checked on 2026-05-06.

## What OpenClaw Is

OpenClaw is the full personal assistant runtime.

Its core model is:

- A long-lived Node.js Gateway process owns all channels, sessions, tools, web UI, model routing, plugin loading, and device/node connections.
- Clients, apps, nodes, and the web UI speak to the Gateway over a typed WebSocket protocol.
- The Gateway is the authority for sessions, routing, pairing, model selection, tool policy, cron, logs, and health.
- Agent runs are serialized per session, stream lifecycle/tool/assistant events, persist transcripts, and assemble prompts from skills, bootstrap files, memory, session history, and model/provider config.
- Plugins are first-class. They can register providers, channels, hooks, HTTP routes, tools, services, prompt injections, model catalogs, memory providers, and runtime lifecycle hooks.
- Tool execution normally assumes access to a host or sandbox backend. Supported sandbox backends include Docker, SSH, and OpenShell, but the Gateway itself still runs as a normal host process.

Important OpenClaw implementation surfaces:

- CLI entrypoint: `openclaw.mjs` -> `src/entry.ts` -> `src/cli/run-main.ts`.
- Gateway lazy startup: `src/gateway/server.ts` -> `src/gateway/server.impl.ts`.
- WebSocket protocol and methods: `src/gateway/server-methods/*`.
- Agent execution path: `src/agents/agent-command.ts`, `src/agents/command/*`, `src/agents/pi-embedded-runner/*`.
- Plugin registry: `src/plugins/registry.ts` and `packages/plugin-sdk`.
- Storage layout: `~/.openclaw/openclaw.json`, `~/.openclaw/agents/<agentId>/sessions/*`, workspace and skills under `~/.openclaw`.

## What NemoClaw Is

NemoClaw is not a replacement for OpenClaw. It is an opinionated wrapper that runs OpenClaw inside NVIDIA OpenShell.

Its core model is:

- A host-side `nemoclaw` CLI handles onboarding, preflight checks, Docker/OpenShell orchestration, sandbox lifecycle, status, logs, recovery, backup/restore, and uninstall.
- A versioned blueprint defines the sandbox image, inference profiles, pinned image digest, OpenShell compatibility, ports, and policy additions.
- OpenShell creates a gateway container with embedded k3s; the sandbox runs as a Kubernetes pod inside that gateway.
- OpenShell owns credential storage and an L7 proxy. The sandbox talks to placeholder/internal routes, while the gateway injects real credentials at egress.
- The NemoClaw OpenClaw plugin is intentionally thin. It registers `/nemoclaw`, a managed inference provider, runtime context injection, and secret-write guard hooks.
- NemoClaw adds deny-by-default network/filesystem/process policy and injects a `<nemoclaw-runtime>` context block so the agent understands it is sandboxed.

Important NemoClaw implementation surfaces:

- CLI dispatch: `src/nemoclaw.ts`, `src/commands/*`, `src/lib/onboard.ts`.
- Registry/state: `src/lib/state/registry.ts`, `src/lib/state/sandbox.ts`.
- OpenClaw plugin: `nemoclaw/src/index.ts`, `nemoclaw/src/runtime-context.ts`, `nemoclaw/src/commands/slash.ts`.
- Blueprint runner: `nemoclaw/src/blueprint/runner.ts`.
- Blueprint config: `nemoclaw-blueprint/blueprint.yaml`.
- Baseline policy: `nemoclaw-blueprint/policies/openclaw-sandbox.yaml`.
- Sandbox image patching/startup: `Dockerfile`, `scripts/nemoclaw-start.sh`, `scripts/lib/sandbox-init.sh`.

## Main Differences

| Area | OpenClaw | NemoClaw |
| --- | --- | --- |
| Product role | Personal assistant Gateway and runtime | Hardened reference stack for running OpenClaw inside OpenShell |
| Primary process | Long-lived Node Gateway | Host CLI plus OpenShell gateway/container/pod lifecycle |
| Security boundary | Single trusted operator boundary; optional sandboxed tools | OpenShell sandbox is the default runtime boundary |
| Tool execution | Host by default; Docker/SSH/OpenShell optional | Inside OpenShell-managed sandbox |
| Credential handling | Config/auth profiles/secrets in OpenClaw host state | Credentials stay in OpenShell gateway and are injected at egress |
| Network policy | Tool/channel policy plus optional sandbox backend policy | Deny-by-default network policy enforced by OpenShell proxy |
| Filesystem model | Host workspace and session files, optionally bridged to sandbox | `/sandbox` writable, system paths mostly read-only |
| Extensibility | Broad plugin SDK with providers, channels, hooks, tools, services | Thin OpenClaw plugin plus versioned blueprint |
| Deployment | npm, source checkout, Docker, daemon services | Docker + OpenShell + embedded k3s + pinned sandbox image |
| Operational UX | `openclaw onboard`, `gateway`, `doctor`, `plugins`, `channels` | `nemoclaw onboard`, `<sandbox> connect/status/logs/rebuild/destroy` |

## Cloudflare Translation

The Cloudflare version should not try to lift OpenClaw/NemoClaw directly. The server assumptions are too different.

Recommended target: implement an OpenClaw-compatible protocol subset and grow toward fuller OpenClaw-like ergonomics. Compatibility means preserving the important WebSocket frame shapes, method names, event streams, idempotency behavior, and OpenAI-compatible HTTP surfaces where practical; it does not mean porting every host-specific tool or channel.

### Cloudflare Runtime Mapping

| Existing concept | Cloudflare equivalent |
| --- | --- |
| OpenClaw Gateway process | Router Worker + per-agent Durable Object or Cloudflare Agent |
| Gateway WebSocket protocol | Durable Object/Agent WebSockets with hibernation |
| Session queue | Durable Object single-threaded actor plus SQLite tables |
| Background queue | Cloudflare Queues for retries, fanout, delivery, indexing, and async side effects |
| Session transcripts | Durable Object SQLite for hot metadata, R2 for transcript blobs |
| Config file | D1/account config plus DO-local snapshots |
| Auth profiles/secrets | Workers Secrets or Secrets Store bindings |
| Plugin code | Curated native plugins, then Dynamic Workers for isolated JS plugins |
| Tool execution | Isolate-native tools first; Containers only for shell/native tasks |
| OpenShell L7 proxy | Worker fetch policy layer for isolates; Container outbound handlers for Containers |
| Blueprint | `clawflare.blueprint.json` or `clawflare.toml` generating bindings, policies, queues, containers |
| Cron | Workers Cron Triggers + Workflows |
| Long-running tasks | Workflows, Queues, or Agent durable fibers |
| Browser tool | Browser Run where possible; Container browser only when longer/native browser state is required |
| Local model providers | Remote providers, Workers AI, AI Gateway; Containers only for small self-hosted sidecars, not GPU inference |

### What Stays In Workers Isolates

- HTTP and WebSocket control plane.
- Telegram webhook inbound/outbound as the primary MVP communication channel; WebChat remains a debug/control fallback.
- Session routing, queueing, pairing, auth, presence, health, model routing, prompt assembly, memory retrieval, and transcript indexing.
- Provider calls to OpenAI-compatible APIs, Anthropic-compatible APIs, Cloudflare Workers AI, and Cloudflare AI Gateway.
- Safe tools that can be expressed as pure Fetch/storage operations: web fetch, search API calls, HTTP webhooks, R2 file reads/writes, D1 queries, Vectorize search, message sends.
- Dynamic Worker sandboxes for generated/user plugin code that only needs Fetch plus explicit bindings.

### What Needs Containers

Use Containers only for tasks that genuinely require a Linux process model:

- Shell execution, package managers, git checkouts, language toolchains, compilers, linters, tests.
- Existing CLI-based model runtimes or agent harnesses that assume a filesystem and subprocesses.
- Native modules not available in Workers.
- Long-lived browser automation when Browser Run limits are not enough.
- Compatibility mode for running portions of OpenClaw itself as a containerized backend.

Cloudflare Containers are currently beta and Workers Paid only. Instance types currently range from `lite` through `standard-4`, with up to 4 vCPU, 12 GiB memory, and 20 GB disk for predefined/custom limits. They also support outbound interception, allow/deny hosts, runtime egress policy changes, and Worker-side credential injection, which maps closely to NemoClaw's OpenShell proxy pattern.

## ClawHub And Plugin Compatibility

Clawflare should support agent-native plugin installation, not just CLI installation. The target UX should mirror OpenClaw's chat-native plugin control:

- User: "Install `clawhub:@openclaw/voice-call`."
- User: "Install `openclaw-codex-app-server`."
- User: "Show plugin `voice-call` and enable it."
- Agent tool calls: `plugin.resolve` -> `plugin.planInstall` -> operator approval -> `plugin.install` -> `plugin.enable`.

The resolver should accept the same major reference classes OpenClaw users expect:

- `clawhub:<package>` for ClawHub-only plugin installs.
- Bare npm-safe package names, resolved as ClawHub first and npm fallback.
- Exact versions such as `clawhub:pkg@1.2.3` when ClawHub exposes that version.
- GitHub or marketplace references later, after the sandbox story is settled.
- Local paths should not be part of hosted Clawflare MVP because Workers have no operator-local filesystem.

Agent install flow:

1. Resolve the reference without executing plugin code.
2. Fetch metadata and archive into a quarantined R2 object.
3. Parse `openclaw.plugin.json`, bundle manifests, and `package.json.openclaw`.
4. Check advertised `pluginApi`, `minGatewayVersion`, `openclaw.install.minHostVersion`, plugin format, requested capabilities, and Clawflare compatibility tier.
5. Run static scanning for dangerous code, undeclared network use, native dependencies, postinstall/build scripts, filesystem/process APIs, and secret handling.
6. Produce a human-readable install plan: source, version, integrity, capabilities, config schema, required secrets, runtime tier, unsupported features, and whether Containers are required.
7. Require explicit operator approval before installing, enabling, updating, or granting new capabilities.
8. Persist install metadata in D1 and archive contents in R2, with integrity hashes and source metadata for updates.
9. Activate only supported surfaces. Unsupported capabilities remain visible in diagnostics but disabled.
10. Restart/reload the affected Durable Object or Dynamic Worker runtime after activation.

Compatibility tiers:

| Tier | Plugin type | Clawflare behavior |
| --- | --- | --- |
| 1 | ClawHub skills | Install to R2 virtual workspace and inject into prompt context. |
| 2 | Compatible bundles | Load skill roots, command prompts, hook packs, and static config that map cleanly to Workers. |
| 3 | Native provider/search/fetch/media plugins | Run through a Clawflare plugin SDK shim in an isolate or Dynamic Worker if they avoid Node host APIs. |
| 4 | Native channel plugins | Support only webhook/API-friendly channels first; local-device and unofficial protocol channels need bridges or Containers. |
| 5 | Native tool/service/CLI plugins | Disabled by default unless explicitly ported to the Clawflare SDK or assigned to a Container sandbox. |
| 6 | Native modules, shell, browser daemons, package-manager plugins | Container-only, with network policy and no raw secrets. |

The agent must never silently grant plugin power. Plugin installation is a privileged operation, and enablement should be separate from download unless the plugin is first-party, signed, compatible, and only requests low-risk capabilities.

Agent-visible commands and tools:

- Slash commands: `/plugin search`, `/plugin install`, `/plugin show`, `/plugin enable`, `/plugin disable`, `/plugin update`.
- Agent tools: `plugins_search`, `plugins_resolve`, `plugins_plan_install`, `plugins_install`, `plugins_enable`, `plugins_disable`, `plugins_update`, `plugins_inspect`.
- Policy: search/inspect can be read-scope; install/update/enable/disable require operator admin approval.
- Audit: every install/update/enable writes a signed audit record with actor, source, version, hash, capabilities, approval, and resulting runtime tier.

## Proposed Architecture

```text
Clients / Channels
  |
  v
Router Worker
  - Auth, routing, static assets, public HTTP APIs
  - Dispatches to agent Durable Objects
  - Receives provider/channel webhooks
  |
  +--> Agent Durable Object / Cloudflare Agent
       - WebSocket coordination
       - Session queue and run state
       - SQLite-backed session metadata
       - Prompt assembly
       - Tool policy decisions
       - Model/provider streaming
       - Runtime context injection
       |
       +--> Storage
       |    - DO SQLite: hot state, queues, sessions, pairing
       |    - D1: account/global config and indexes
       |    - R2: transcripts, attachments, artifacts, backups
       |    - KV: low-risk cached catalog/config reads
       |    - Vectorize: memory embeddings
       |
       +--> Isolate Tool Runtime
       |    - Native Workers tools
       |    - Dynamic Worker plugin/tool sandboxes
       |    - Fetch allowlists and per-tool budgets
       |    - ClawHub skills and compatible plugin shims
       |
       +--> Workflow / Queue Workers
       |    - Durable long-running jobs
       |    - Human approval waits
       |    - Retried background tasks
       |    - Delivery, indexing, plugin scans, and webhook fanout
       |
       +--> Container Sandbox, optional
            - Per-agent or per-session Linux sandbox
            - Outbound policy and credential injection in Worker code
            - R2-backed artifacts and snapshots
```

## Security Model

Cloudflare changes the security boundary. There is no host filesystem to protect inside the Worker path, but there is also no POSIX sandbox for arbitrary tools unless we use Containers.

Baseline rules:

- Treat every inbound channel message as untrusted.
- Keep one trust boundary per account/agent unless we explicitly build tenant isolation.
- Default to no shell. Shell is a Container-only capability requiring explicit policy.
- Keep provider/channel credentials out of model-visible context and out of tool sandboxes.
- Route every provider call through a policy-aware provider gateway so usage, caching, redaction, and allowlists are centralized.
- Represent "filesystem" as a virtual workspace backed by R2/D1 metadata; expose file tools only through that API.
- Require idempotency keys for side-effecting API calls.
- Persist run checkpoints before and after every model/tool boundary.
- Make outbound policy declarative and inspectable by the agent, similar to NemoClaw runtime context.
- For Containers, start with `enableInternet = false`, explicit `allowedHosts`, and outbound handlers for credential injection.

## Queue Usage Model

Yes, Clawflare should use Cloudflare Queues, but not as the primary agent-turn ordering primitive.

Durable Objects should own per-agent and per-session ordering because they provide actor-local serialization and colocated session state. This mirrors OpenClaw's per-session run lane more closely than a distributed queue.

Use Cloudflare Queues for work that can be retried, batched, delayed, or processed outside the hot WebSocket turn:

- Channel outbound delivery retries.
- Webhook ingestion fanout after initial authentication and dedupe.
- Transcript post-processing, search indexing, and memory embedding writes.
- Plugin archive scanning and compatibility analysis.
- Audit-log export and metrics aggregation.
- Attachment/media processing that should not block the agent turn.
- Container lifecycle jobs that can be retried independently.
- Dead-letter handling for failed sends, failed scans, and failed indexing.

Do not use Queues for:

- Strict per-session agent turn serialization.
- WebSocket response streaming.
- Immediate model/tool event ordering.
- Approval waits that need durable state transitions; use Workflows or Durable Object state for those.

Recommended queue names for MVP:

- `channel-delivery`
- `webhook-events`
- `transcript-indexing`
- `plugin-scans`
- `audit-events`

Each queue message should carry `accountId`, `agentId`, `sessionKey` when relevant, `idempotencyKey`, `attempt`, and a compact payload pointer to R2/D1 rather than large inline bodies.

## Major Constraints

- Workers isolates cannot run arbitrary binaries, local shell commands, Docker, k3s, or normal Node native modules.
- Workers memory is limited to 128 MB per isolate, and startup must stay fast.
- Worker request CPU is metered; paid Workers can have much higher CPU budgets than free Workers, but we should design for streaming and offloading rather than CPU-heavy isolate work.
- Durable Objects can hibernate; in-memory state must be treated as cache. State needed after hibernation belongs in DO SQLite/R2/D1.
- Workflows are better for durable background steps than trying to keep an HTTP request alive.
- Browser Run has account concurrency/rate/idle limits. It is useful, but not a substitute for all browser-control scenarios.
- Containers are powerful but beta, bill while running, and should be an escape hatch rather than the default runtime.
- Some OpenClaw channels depend on local device state or unofficial protocols. Cloudflare can support API/webhook channels first; local-device channels need paired nodes or external bridges.

## Repository Structure Philosophy

Follow the OpenClaw/NemoClaw structure philosophy, but adapt it to Cloudflare:

- Keep the runtime core small and explicit.
- Put optional capabilities in `extensions/`, not in core.
- Keep Cloudflare binding/runtime code separate from provider/channel/tool logic.
- Keep protocol schemas and generated artifacts isolated.
- Keep operational scripts in `scripts/`, deploy manifests in `deploy/`, and user-facing docs in `docs/`.
- Prefer feature-owned tests next to implementation for core modules, with larger scenario tests in `qa/`.
- Avoid "misc" folders. If a module does not have a clear owner, define the boundary before adding it.

Proposed initial tree:

```text
clawflare/
├── src/
│   ├── entry.ts                    # Worker entrypoint
│   ├── router/                     # HTTP routing, webhooks, OpenAI-compatible endpoints
│   ├── gateway/                    # WebSocket protocol, auth, client frames, health
│   ├── agents/                     # Agent DO/Agent runtime, run loop, prompt assembly
│   ├── sessions/                   # Session keys, queues, transcripts, compaction
│   ├── providers/                  # Model provider registry and shared transport
│   ├── tools/                      # Built-in isolate-native tools
│   ├── channels/                   # Telegram primary channel plus debug/control WebChat
│   ├── plugins/                    # ClawHub resolver, manifests, SDK shim, registry
│   ├── workflows/                  # Workflow/Queue task contracts and runners
│   ├── containers/                 # Optional Container backend contracts and RPC
│   ├── storage/                    # D1, R2, KV, DO SQLite adapters
│   ├── security/                   # Auth, approvals, policies, scanners, audit
│   ├── config/                     # Config schema, migrations, effective config
│   ├── protocol/                   # WS/HTTP schema, generated types
│   ├── memory/                     # Vectorize and memory abstractions
│   ├── cli/                        # Local CLI helpers for deploy/onboard/doctor
│   ├── web/                        # Control UI assets/API integration
│   └── shared/                     # Small cross-cutting utilities only
├── extensions/                     # First-party plugins/extensions
│   ├── cloudflare-ai-gateway/
│   ├── telegram/
│   ├── web-fetch/
│   └── memory-vectorize/
├── schemas/                        # JSON schemas for config, protocol, manifests
├── migrations/                     # D1 and DO SQLite migrations
├── scripts/                        # Codegen, validation, release, local automation
├── deploy/                         # Wrangler configs, environment templates, IaC notes
├── docs/                           # Architecture, security, runbooks, user docs
├── qa/                             # End-to-end scenarios and compatibility fixtures
├── skills/                         # Built-in baseline skills, if any
└── PLAN.md
```

Boundary rules:

- `src/router` can call Durable Objects and storage bindings, but should not know provider internals.
- `src/agents` owns run lifecycle and can call providers, tools, sessions, plugins, and workflows through interfaces.
- `src/plugins` owns compatibility and install state, but plugin runtime surfaces must register into providers/tools/channels/hooks instead of reaching into internals.
- `src/containers` is optional. Core should compile and run without any Container binding.
- `extensions/*` must only import public Clawflare SDK surfaces, not `src/*` internals.
- `src/shared` must stay small. If a utility grows domain behavior, move it to an owned module.

## Decisions Before Implementation

Define these before writing production code:

| Decision | Recommendation |
| --- | --- |
| Product stance | Build a Cloudflare-native runtime with OpenClaw-compatible protocol subset support, not a direct host-runtime port. |
| Protocol target | Target an OpenClaw-compatible WebSocket subset plus OpenAI-compatible HTTP endpoints. |
| First runtime | Workers + Durable Objects only; Containers are designed but not required for MVP. |
| State model | DO SQLite for hot per-agent/session state; D1 for account/global indexes; R2 for transcripts/artifacts; Vectorize for memory. |
| Plugin stance | ClawHub skill install in MVP; native plugin planning/inspection in MVP; native execution only through a constrained SDK shim later. |
| Security baseline | No shell by default, explicit approvals for install/enable/update, deny-by-default outbound policy, no raw secrets in plugin/tool sandboxes. |
| First channels | Telegram webhook first; WebChat only as a local/debug fallback; Slack/Discord later if webhook/API mode is enough. |
| First providers | Cloudflare AI Gateway, OpenAI-compatible, Anthropic-compatible, Workers AI. |
| First tools | R2 workspace, web fetch, message send, workflow task, memory search. |
| CLI scope | `clawflare dev/deploy/onboard/status/doctor/logs` only at first. |
| Test baseline | Unit tests for policies/resolvers/protocol; Miniflare integration tests for Worker/DO; QA scenarios for agent turns and plugin install. |

Minimum implementation contracts to write first:

- `AgentRuntime` interface for starting turns, streaming events, and waiting for runs.
- `ProviderRuntime` interface for model discovery, auth status, and streaming completions/responses.
- `ToolRuntime` interface with policy-checked invocation and typed results.
- `PluginManifest` and `PluginInstallPlan` schemas.
- `StorageRuntime` interface for sessions, transcripts, workspace files, and install records.
- `PolicyRuntime` interface for outbound, tool, channel, plugin, and container decisions.
- `GatewayProtocol` schemas for connect, request, response, event, and error frames.
- `QueueMessage` schemas for channel delivery, webhook events, transcript indexing, plugin scans, and audit events.

## Build Plan

### Phase 0: Scope Spike

Goal: decide how compatible we want to be with OpenClaw.

Deliverables:

- Document which OpenClaw Gateway methods/events are in-scope, stubbed, or intentionally unsupported for the MVP.
- Define the exact OpenClaw-compatible Gateway protocol subset for MVP: `connect`, `health`, `agent`, `agent.wait`, `chat.send`, `sessions`, `models`, and stream events.
- Define the MVP Telegram channel contract: webhook verification, allowlists/pairing, DM/group routing, outbound delivery, and retry semantics. WebChat is debug-only.
- Define the MVP provider set. Recommended: OpenAI-compatible, Anthropic-compatible, Workers AI, Cloudflare AI Gateway.
- Define the first tool set. Recommended: web fetch with allowlist, R2 file workspace, D1 query, message send, workflow start/status.
- Define whether Containers are in MVP or Phase 2. Recommendation: not required for MVP; design interfaces now.

### Phase 1: Repository Scaffold

Goal: create a Cloudflare Worker application with testable modules.

Deliverables:

- `wrangler.toml` or `wrangler.jsonc` with Durable Object, R2, D1, KV, Queue, Workflow, Vectorize, Secrets, and optional Container bindings.
- TypeScript project with strict types.
- Router Worker with `/healthz`, `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/ws`, and `/webhook/:channel`.
- Agent Durable Object class with SQLite schema migrations.
- Initial Queue producers/consumers for `channel-delivery`, `transcript-indexing`, and `plugin-scans`.
- Local Miniflare/Wrangler dev path.

Validation:

- `wrangler dev` starts locally.
- Health and one DO RPC route pass tests.
- Basic deploy works without Containers.
- Queue consumers can process idempotent test messages and dead-letter failures.

### Phase 2: Agent Core

Goal: reproduce the OpenClaw agent-loop shape in Cloudflare terms.

Deliverables:

- Session model: account, agent, sessionKey, sessionId, runId.
- Per-session serialized queue in Durable Object.
- Streaming event model: lifecycle, assistant, tool, usage, error.
- Prompt assembly: system prompt, runtime context, skills summary, transcript window.
- Provider router with streaming support and provider-normalized errors.
- Transcript persistence to R2 with DO/D1 indexes.
- OpenAI-compatible HTTP endpoints backed by the agent loop.

Validation:

- WebSocket client can submit a prompt and receive streamed lifecycle/assistant events.
- HTTP `/v1/responses` can invoke the default agent.
- Agent survives DO hibernation between turns.

### Phase 3: Cloudflare-Native Tools

Goal: build useful tools without shell access.

Deliverables:

- Virtual workspace API backed by R2 and D1 metadata.
- File tools: list, read, write, patch, artifact publish.
- Web fetch tool with SSRF checks, hostname allowlists, response size caps, and content extraction.
- Message send tool for supported channels.
- Vector memory tools with Vectorize and embeddings provider abstraction.
- Workflow tools: start, status, cancel, approve.
- Policy engine returning explicit allow/deny reasons.

Validation:

- Tool calls are logged, policy-checked, and persisted.
- Denied network/file actions produce agent-visible explanations.
- Large files stream through R2 rather than isolate memory.

### Phase 4: Plugin Strategy

Goal: preserve OpenClaw's extensibility without giving plugins host power.

Deliverables:

- Manifest format inspired by `openclaw.plugin.json`, but Cloudflare-safe.
- ClawHub-aware resolver accepting `clawhub:<pkg>`, bare ClawHub-first names, and exact versions.
- Agent-native plugin management tools and slash commands for search, install, show, enable, disable, and update.
- Quarantine/install pipeline using R2 for archives, D1 for install records, and static compatibility scanning before activation.
- First-party native plugin API for providers/channels/tools/hooks.
- Dynamic Worker plugin runtime for untrusted JS plugins.
- Binding capability manifest: plugin receives only declared bindings.
- Custom limits for Dynamic Worker CPU/subrequests.
- Plugin registry stored in D1/R2, with signed package metadata.
- Compatibility reports that show unsupported OpenClaw SDK methods rather than failing opaquely.
- Separate download/install/enable states so the agent cannot silently activate newly downloaded code.

Validation:

- A simple provider plugin can be installed and called.
- A Dynamic Worker plugin cannot access undeclared bindings.
- Network-disabled plugin mode works for pure transforms.
- Agent can install a ClawHub skill by name and use it in the next turn.
- Agent can plan a native plugin install and require operator approval before enablement.
- Unsupported plugins fail closed with a clear reason and no partial activation.

### Phase 5: Telegram Channel

Goal: make Telegram the primary MVP communication surface.

Deliverables:

- Telegram webhook channel.
- Telegram outbound delivery through `channel-delivery`.
- Telegram sender allowlists and pairing approval.
- Telegram DM and group mention routing.
- Telegram command handling for `/status`, `/plugin`, and basic admin flows.
- WebChat over DO WebSockets as debug/control fallback.
- Slack, Discord, and generic webhook channels are post-MVP.

Validation:

- Telegram webhook can trigger an agent turn.
- Telegram replies are delivered idempotently through `channel-delivery`.
- Unknown Telegram senders are blocked or paired by default.
- Telegram per-peer session isolation works.
- Telegram group messages require a mention by default.

### Phase 6: Containers Escape Hatch

Goal: add Linux-native task execution without making it the default.

Deliverables:

- Container class per logical sandbox: `agent:<id>` or `session:<id>`.
- Container tool RPC: exec, process, read/write bridge, git, test runner.
- R2-backed snapshot import/export.
- Outbound policy with `enableInternet = false`, `allowedHosts`, HTTPS interception, and Worker-side credential injection.
- Container lifecycle controls: start, stop, sleepAfter, health, logs, reset.
- Runtime context injection mirroring NemoClaw's policy summary.

Validation:

- Container cannot reach disallowed hosts.
- Container never receives raw provider credentials.
- Workspace changes can be snapshotted to R2 and restored.
- Failed/stale containers are recoverable from Worker control plane.

### Phase 7: Operations And UX

Goal: make it operable like OpenClaw/NemoClaw.

Deliverables:

- CLI: `clawflare deploy`, `clawflare onboard`, `clawflare status`, `clawflare logs`, `clawflare doctor`.
- Web dashboard for agents, sessions, channels, config, model auth status, tool policy, and approvals.
- Audit command checking public routes, auth mode, channel allowlists, secret bindings, container egress, and stale workflows.
- Backup/export path for D1/R2/DO state.
- Metrics and logs with redaction.

Validation:

- Fresh account can onboard through CLI.
- Doctor catches intentionally unsafe channel/tool/container config.
- Rollback/export story is documented and tested.

## MVP Recommendation

Build a Workers-only MVP first:

- Router Worker.
- Agent Durable Object with WebSocket and HTTP OpenAI-compatible endpoints.
- One model provider through Cloudflare AI Gateway or direct OpenAI-compatible API.
- Telegram webhook as the main communication path.
- Telegram outbound delivery, allowlists/pairing, and mention-gated groups.
- WebChat only as a debug/control fallback.
- R2 virtual workspace.
- Web fetch tool with allowlist.
- Workflow-backed long-running task stub.
- ClawHub skill install by agent request.
- ClawHub/native plugin install planning and inspection, but no arbitrary native plugin execution in the first milestone.
- No shell and no Containers in the first milestone.

This proves the product shape without dragging in the hardest compatibility surface.

Then add Containers as a clearly labeled "Linux sandbox" backend for advanced tools. That mirrors NemoClaw's safety goals while keeping the default Cloudflare experience isolate-native and cheap while idle.

## Open Questions

- Should this be a new product or a Cloudflare deployment backend for OpenClaw?
- Is arbitrary user-generated code a requirement? If yes, Dynamic Workers should be prioritized before Containers.
- Should the agent be allowed to auto-install low-risk skills after approval once, or should every install require per-action approval?
- Which plugin reference sources are allowed beyond ClawHub: npm fallback, GitHub archives, Claude marketplaces, or only signed ClawHub packages?
- What exact subset of `openclaw/plugin-sdk` should the Clawflare shim support in v1?
- Do we need coding-agent shell capability in v1? If yes, Containers become part of MVP.
- Should config be account-global in D1 or agent-local in Durable Object SQLite with export/import?

## Current Cloudflare References

- OpenClaw plugin install and chat-native control: https://docs.openclaw.ai/tools/plugin
- ClawHub registry behavior: https://docs.openclaw.ai/tools/clawhub
- OpenClaw plugin manifest: https://docs.openclaw.ai/plugins/manifest
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Durable Objects overview: https://developers.cloudflare.com/durable-objects/
- Durable Objects WebSockets and hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Objects SQLite storage: https://developers.cloudflare.com/durable-objects/api/sql-storage/
- Cloudflare Agents long-running model: https://developers.cloudflare.com/agents/concepts/long-running-agents/
- Cloudflare Agents durable execution: https://developers.cloudflare.com/agents/api-reference/durable-execution/
- Workflows: https://developers.cloudflare.com/workflows/
- Dynamic Workers: https://developers.cloudflare.com/dynamic-workers/getting-started/
- Dynamic Workflows: https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows/
- Workers for Platforms dispatch namespaces: https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/
- Service bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Containers overview: https://developers.cloudflare.com/containers/
- Containers limits and instance types: https://developers.cloudflare.com/containers/platform-details/limits/
- Containers outbound traffic and credential injection: https://developers.cloudflare.com/containers/platform-details/outbound-traffic/
- Browser Run limits: https://developers.cloudflare.com/browser-run/limits/
