# Clawflare TODO

This is the execution checklist for the approved MVP implementation. Work through it in order. Do not skip compatibility, schema, or security gates to move faster.

## 0. Project Scaffold

- [x] Create `package.json` with TypeScript, Wrangler, Vitest, Cloudflare test pool, TypeBox, lint, and format dependencies.
- [x] Create `tsconfig.json` for strict ESM TypeScript.
- [x] Create `vitest.config.ts`.
- [x] Create `wrangler.jsonc` with Worker, Durable Object, D1, R2, KV, Queue, Vectorize, AI, and secrets placeholders.
- [x] Create the initial folder tree from `IMPLEMENTATION.md`.
- [x] Add `.gitignore`.
- [x] Add initial `README.md` with dev commands and MVP scope.
- [x] Add `src/env.ts` with typed Cloudflare bindings.
- [x] Add `src/entry.ts` with placeholder `fetch`, `queue`, and `AgentObject` exports.
- [x] Verify `pnpm typecheck` and `pnpm test` can run.

## 1. Core Protocol And Routing

- [x] Implement `src/protocol/frames.ts` for OpenClaw-compatible `req`, `res`, and `event` frames.
- [x] Implement `src/protocol/errors.ts` with typed errors such as `UNAUTHORIZED`, `BAD_REQUEST`, `NOT_IMPLEMENTED`, `CONFLICT`, and `INTERNAL`.
- [x] Implement `src/protocol/connect.ts` with `connect.challenge` and MVP `hello-ok`.
- [x] Implement `src/router/index.ts`.
- [x] Implement `GET /healthz`.
- [x] Implement basic route dispatch for `/ws`, `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/webhook/telegram`, and `/tools/invoke`.
- [x] Return structured `NOT_IMPLEMENTED` for known-but-unsupported compatibility routes.
- [x] Add protocol unit tests and route smoke tests.

## 2. Durable Object Gateway

- [x] Implement `src/agents/agent-object.ts` as the primary Durable Object.
- [x] Add WebSocket accept/hibernation-compatible connection handling.
- [x] Send `connect.challenge` after WS connection opens.
- [x] Implement `connect` method with shared-token auth.
- [x] Implement connection state, sequence numbers, and heartbeat/tick events.
- [x] Implement `health` method.
- [x] Implement method dispatcher in `src/gateway/methods.ts`.
- [x] Add tests for WS challenge, connect success, connect failure, health, and unknown method errors.

## 3. Storage Foundations

- [x] Add D1 migrations for `accounts`, `agents`, `plugin_installs`, `audit_events`, and `idempotency_keys`.
- [x] Add DO SQLite migrations for `sessions`, `runs`, `run_events`, `workspace_index`, and `plugin_runtime_state`.
- [x] Implement `src/storage/d1.ts`.
- [x] Implement `src/storage/r2.ts`.
- [x] Implement `src/storage/do-sqlite.ts`.
- [x] Implement R2 key helpers for transcripts, run events, workspace files, plugins, and artifacts.
- [x] Add migration and storage adapter tests.

## 4. Agent Run Loop

- [x] Define `AgentRuntime` types in `src/agents/runtime.ts`.
- [x] Implement session key normalization in `src/sessions/keys.ts`.
- [x] Implement session store in `src/sessions/store.ts`.
- [x] Implement per-session lane serialization in `src/sessions/lanes.ts`.
- [x] Implement run creation, accepted ack, lifecycle start/end/error, and run event persistence.
- [x] Implement fake provider for deterministic tests.
- [x] Implement prompt assembly skeleton with `<clawflare-runtime>` block.
- [x] Implement `agent` method.
- [x] Implement `agent.wait` method.
- [x] Persist transcript JSONL to R2.
- [x] Enqueue transcript indexing and audit queue messages after terminal run state.
- [x] Add tests for accepted ack, streaming events, run wait, serialization, and transcript persistence.

## 5. Provider Runtime

- [x] Define `ProviderRuntime` interface.
- [x] Implement provider registry.
- [x] Implement `openai-compatible` provider.
- [x] Implement `anthropic-compatible` provider if needed for MVP model choice.
- [x] Implement `workers-ai` provider wrapper.
- [x] Implement `cloudflare-ai-gateway` provider using OpenClaw plugin behavior as reference.
- [x] Implement model ref parsing as `provider/model`.
- [x] Implement secret resolution without logging values.
- [x] Implement provider auth status without exposing secrets.
- [x] Implement normalized provider errors.
- [x] Add provider unit tests with mocked fetch.

## 6. OpenAI-Compatible HTTP

- [x] Implement `GET /v1/models`.
- [x] Implement `GET /v1/models/:id`.
- [x] Implement non-streaming `POST /v1/chat/completions`.
- [x] Implement non-streaming `POST /v1/responses`.
- [x] Map HTTP requests into the AgentObject run path.
- [x] Add OpenAI-compatible response fixtures.
- [x] Add tests for models, chat completions, responses, auth failure, and provider failure.

## 7. Queue Infrastructure

- [x] Define `QueueEnvelope<T>` schemas.
- [x] Implement `src/queues/index.ts`.
- [x] Implement `channel-delivery` consumer skeleton.
- [x] Implement `webhook-events` consumer skeleton.
- [x] Implement `transcript-indexing` consumer skeleton.
- [x] Implement `plugin-scans` consumer skeleton.
- [x] Implement `audit-events` consumer skeleton.
- [x] Add idempotency checks for queue consumers.
- [x] Add dead-letter/final failure audit behavior.
- [x] Add queue tests for idempotent processing and permanent failure handling.

## 8. Built-In Tools

- [x] Define `ToolRuntime` interface.
- [x] Implement tool registry.
- [x] Implement `tools.catalog` method.
- [x] Implement `workspace_list`.
- [x] Implement `workspace_read`.
- [x] Implement `workspace_write`.
- [x] Implement `workspace_patch`.
- [x] Implement `web_fetch` with SSRF checks, hostname allowlist, response caps, and content extraction.
- [x] Implement `message_send` through channel runtime.
- [x] Implement `memory_search` stub or Vectorize-backed minimal version.
- [x] Implement tool policy checks in `src/security/policy.ts`.
- [x] Add tests for tool schema validation, allowed calls, denied calls, and R2-backed workspace behavior.

## 9. Telegram Primary Channel

- [ ] Implement `src/channels/types.ts`.
- [ ] Implement `src/channels/session-routing.ts`.
- [ ] Implement `src/channels/telegram.ts`.
- [ ] Implement Telegram webhook verification using `X-Telegram-Bot-Api-Secret-Token`.
- [ ] Add `TELEGRAM_WEBHOOK_SECRET` to env typing and docs.
- [ ] Implement dedupe by Telegram `update_id`.
- [ ] Normalize Telegram direct messages.
- [ ] Normalize Telegram group messages.
- [ ] Enforce mention/command requirement for groups.
- [ ] Implement unknown-sender pairing/approval response.
- [ ] Implement allowlist storage and checks.
- [ ] Implement `src/channels/telegram-delivery.ts` using `sendMessage`.
- [ ] Split long Telegram messages safely.
- [ ] Add reply-to behavior when message ID is available.
- [ ] Retry transient/rate-limit failures through `channel-delivery`.
- [ ] Do not retry permanent Telegram authorization failures.
- [ ] Implement Telegram `/start`.
- [ ] Implement Telegram `/help`.
- [ ] Implement Telegram `/status`.
- [ ] Implement Telegram `/plugin search <query>`.
- [ ] Implement Telegram `/plugin install <ref>` as install-plan flow.
- [ ] Implement authenticated `/telegram/status`.
- [ ] Implement authenticated `/telegram/set-webhook`.
- [ ] Add Telegram webhook, routing, pairing, command, and delivery tests with mocked Bot API.

## 10. Debug WebChat

- [ ] Implement minimal `src/channels/webchat.ts`.
- [ ] Implement minimal `src/web/` UI or static debug page.
- [ ] Wire WebChat to the same AgentObject protocol path.
- [ ] Keep WebChat marked debug/control-only in docs and UI.
- [ ] Add smoke tests for debug WebChat send/receive.

## 11. ClawHub Skills And Plugin Planning

- [ ] Implement `src/plugins/clawhub-client.ts`.
- [ ] Implement ClawHub search with KV cache.
- [ ] Implement `src/plugins/resolver.ts` for `clawhub:<package>`, bare names, and optional exact versions.
- [ ] Implement manifest parsing for skills and native plugins.
- [ ] Implement plugin archive quarantine in R2.
- [ ] Implement static scanner for forbidden APIs and package scripts.
- [ ] Implement `PluginInstallPlan` schema.
- [ ] Implement `plugins.search`.
- [ ] Implement `plugins.inspect`.
- [ ] Implement `plugins.planInstall`.
- [ ] Implement `plugins.install` for ClawHub skills only.
- [ ] Implement `plugins.enable` for installed skills.
- [ ] Update prompt assembly to include enabled ClawHub skills.
- [ ] Add Telegram `/plugin install` approval flow around `plugins.planInstall`.
- [ ] Add tests for skill search, plan, install, enable, prompt inclusion, and native-plugin fail-closed behavior.

## 12. Security, Audit, And Doctor

- [ ] Implement `src/security/auth.ts`.
- [ ] Implement scope checks for read/write/admin operations.
- [ ] Implement `src/security/audit.ts`.
- [ ] Emit audit events for plugin install/enable/update.
- [ ] Emit audit events for channel allowlist/pairing changes.
- [ ] Emit audit events for config writes.
- [ ] Add redaction helpers for logs and audit payloads.
- [ ] Implement `src/cli/doctor.ts` or a minimal doctor route/command.
- [ ] Doctor checks required bindings, secrets, unsafe Telegram config, and plugin state.
- [ ] Add security/audit/doctor tests.

## 13. MVP Verification

- [ ] Run unit tests.
- [ ] Run Workers/Miniflare integration tests.
- [ ] Run fake provider end-to-end Telegram webhook test.
- [ ] Run fake provider OpenAI-compatible HTTP test.
- [ ] Run queue idempotency tests.
- [ ] Run ClawHub skill install test with fixture metadata.
- [ ] Run security audit tests.
- [ ] Document local setup.
- [ ] Document deploy setup.
- [ ] Document Telegram bot setup and webhook registration.

## 14. Post-MVP Backlog

- [ ] Streaming HTTP `/v1/chat/completions`.
- [ ] Streaming HTTP `/v1/responses`.
- [ ] Full device pairing.
- [ ] Cloudflare Access or OAuth control UI auth.
- [ ] Native plugin SDK shim execution in Dynamic Workers.
- [ ] Slack channel.
- [ ] Discord channel.
- [ ] Generic webhook channel.
- [ ] Browser Run tool.
- [ ] Container sandbox backend.
- [ ] Inline Telegram approval buttons.
- [ ] Telegram file/photo/audio/document ingest.
- [ ] Multi-agent Telegram routing.
- [ ] Rich control UI.
