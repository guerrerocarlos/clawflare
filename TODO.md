# Clawflare TODO

This is the current backlog after the Telegram-first MVP. Completed build phases are tracked in git history and supporting docs. This file focuses only on remaining work.

## 1. Agent Runtime

- [ ] Expand the current bounded tool loop beyond the initial safe subset.
- [ ] Replace the structured text tool-call protocol with native model tool-calling where possible.
- [ ] Feed tool results back into the model with richer step state and reasoning context.
- [ ] Add stronger tool execution limits, loop guards, and per-run budgets.
- [ ] Add better run-state inspection for debugging provider and tool failures.

## 2. Plugin Runtime

- [ ] Replace the in-memory plugin store with durable runtime state.
- [ ] Persist installed/enabled plugin state independently of Durable Object process lifetime.
- [ ] Define an approved model for plugin-contributed tool definitions.
- [ ] Implement plugin-contributed tools for approved safe plugin types.
- [ ] Design and implement native plugin execution or an explicit non-goal decision.
- [ ] Add plugin upgrade, disable, and uninstall flows.

## 3. Memory And Retrieval

- [ ] Replace the current `memory_search` stub with real retrieval.
- [ ] Decide whether Vectorize remains part of the design or is deferred.
- [ ] Implement transcript chunking and indexing for retrieval.
- [ ] Add memory write policies, retention, and retrieval limits.
- [ ] Expose memory health and index lag in doctor/status surfaces.

## 4. Channels And UX

- [ ] Add inline Telegram approval actions for plugin install and privileged operations.
- [ ] Support Telegram file, photo, audio, and document ingest.
- [ ] Improve group-chat routing, mentions, and multi-agent session mapping.
- [ ] Add a real control UI with auth instead of the current debug-only WebChat.
- [ ] Implement additional channels if still needed: Slack, Discord, generic webhook.

## 5. Provider And Model Operations

- [ ] Add streaming support for `/v1/chat/completions`.
- [ ] Add streaming support for `/v1/responses`.
- [ ] Improve provider observability and structured logging for live failures.
- [ ] Add safer provider failover or fallback behavior.
- [ ] Expand provider compatibility testing across OpenAI-compatible backends.

## 6. Security And Isolation

- [ ] Decide which tasks stay in Workers isolates versus Cloudflare Containers.
- [ ] Add a container-backed execution path for tasks that cannot safely run in isolates.
- [ ] Harden workspace and web-fetch tool policies for real autonomous tool use.
- [ ] Add stronger operator auth for admin/control surfaces, likely Cloudflare Access or OAuth.
- [ ] Review plugin install scanning and quarantine rules before enabling richer plugin execution.

## 7. Deployment And Operations

- [ ] Add durable environment promotion rules for dev/staging/prod.
- [ ] Add automated post-deploy smoke checks beyond webhook sync.
- [ ] Add explicit queue topology management and drift detection.
- [ ] Document backup, restore, and incident procedures for D1/R2/KV state.
- [ ] Add dashboards/alerts for provider failures, queue backlog, and Telegram delivery issues.

## 8. Compatibility

- [ ] Expand the OpenClaw-compatible protocol subset beyond the current MVP surface.
- [ ] Decide which unsupported OpenClaw features are intentionally out of scope.
- [ ] Document compatibility expectations for ClawHub plugins more precisely.
- [ ] Add compatibility tests against real or recorded OpenClaw client flows.
