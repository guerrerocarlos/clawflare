# Clawflare Pending Work

This document explains the work that remains after the Telegram-first MVP. `TODO.md` is the checklist. This file explains why each area is still pending, what the current behavior is, and what decisions still need to be made before implementation.

## 1. Agent Runtime

Current state:

- the agent can receive a Telegram message, build a prompt, call a provider, and return a response
- tools are registered and exposed in the protocol catalog
- direct `tools.invoke` exists through the gateway and HTTP route
- the live run loop can perform a bounded first-pass tool loop using a strict structured tool-call format
- autonomous tool use is currently limited to a small safe subset of tools

What is missing:

- native model tool-calling support instead of the current text wrapper format
- broader tool coverage and more expressive iterative reasoning
- stronger loop guards, per-run budgets, and tool-step accounting for autonomous execution

Why it matters:

- the project has crossed from chat wrapper into early agent behavior, but the current loop is still intentionally narrow
- plugin-contributed tools and richer automation depend on this layer existing first

Implementation concerns:

- tool execution must be bounded to avoid runaway loops
- all tool calls need policy enforcement and structured audit logs
- failure reporting needs to preserve enough detail for live debugging without leaking secrets

## 2. Plugin Runtime

Current state:

- ClawHub packages can be searched, inspected, planned, installed, and enabled
- enabled plugin skills are injected into the prompt as instructions
- plugin manifests and archives are stored, but runtime enable/install state is not durably modeled yet

What is missing:

- installed/enabled plugin state survives inconsistently because the active store is in-memory
- plugins cannot contribute executable tools to the runtime yet
- native plugin execution, hooks, and richer SDK compatibility do not exist
- upgrade, disable, and uninstall workflows are incomplete

Why it matters:

- right now plugin support is useful for prompt shaping, but not yet for real extension of the agent runtime
- compatibility claims with ClawHub and OpenClaw need to stay narrow until executable behavior exists

Implementation concerns:

- plugin state should be durable and auditable
- plugin capabilities need explicit allow/deny rules
- native plugin execution likely requires a stronger isolation model than raw Worker code

## 3. Memory And Retrieval

Current state:

- transcript data is persisted
- a `memory_search` tool exists only as a stub/minimal placeholder
- queue hooks for indexing exist, but retrieval is not a real capability yet

What is missing:

- real chunking, indexing, and retrieval
- a final decision on whether Vectorize is part of the MVP-next design
- retention, deletion, and memory write policies

Why it matters:

- persistent conversational memory and searchable transcripts are central to useful agent behavior
- without retrieval, the agent cannot meaningfully use prior runs beyond what is in the immediate prompt window

Implementation concerns:

- indexing strategy needs to fit Cloudflare cost and latency constraints
- memory must not become an unbounded prompt-dump mechanism
- privacy and operator controls need to be defined before memory becomes richer

## 4. Channels And UX

Current state:

- Telegram is the primary live channel and is working
- WebChat exists as a debug/control surface

What is missing:

- richer Telegram operations such as inline approvals and media/file ingest
- better group-chat routing and multi-agent mapping
- a proper authenticated control UI
- additional channels if they still matter

Why it matters:

- Telegram works for MVP testing, but operator experience is still rough
- install approvals and admin actions are better handled with structured interactions than plain text commands

Implementation concerns:

- group routing must avoid cross-session confusion
- ingest paths for files and media need storage, scanning, and policy decisions
- a control UI should not ship without stronger auth

## 5. Provider And Model Operations

Current state:

- OpenAI-compatible provider integration is working
- the live default path uses OpenRouter with the configured model
- non-streaming HTTP compatibility routes exist

What is missing:

- streaming HTTP responses
- better provider telemetry and structured error surfaces
- optional fallback behavior when the selected provider fails
- broader compatibility coverage across providers

Why it matters:

- streaming is important for client compatibility and responsiveness
- provider failures are one of the most common live operational issues

Implementation concerns:

- streaming must fit the Durable Object and HTTP surface cleanly
- logging must preserve actionable diagnostics without exposing secrets or prompt content carelessly

## 6. Security And Isolation

Current state:

- the MVP runs inside Workers and Durable Objects
- tool policies and plugin scanning exist in a basic form

What is missing:

- a final execution model for tasks that cannot safely run in Workers isolates
- container-backed or otherwise stronger-isolated execution for higher-risk operations
- stronger auth for operator/control surfaces
- a hardened policy model for truly autonomous tool use

Why it matters:

- richer tools and executable plugins increase the blast radius substantially
- the current safe posture depends in part on the fact that the agent is not yet fully autonomous

Implementation concerns:

- Cloudflare Containers should only be introduced for clearly defined tasks
- isolation boundaries need to be explicit before enabling native plugin execution
- auth and audit need to evolve together

## 7. Deployment And Operations

Current state:

- GitHub Actions deploys the Worker
- secrets are synced
- Telegram webhook sync happens after deploy

What is missing:

- formal environment promotion and staging strategy
- post-deploy smoke checks beyond deploy success and webhook sync
- queue topology drift detection and stronger operational validation
- backup, restore, and incident playbooks
- observability for queues, providers, and Telegram delivery

Why it matters:

- the project is deployable, but still operator-heavy
- incidents will be difficult to reason about without basic dashboards and procedures

Implementation concerns:

- deployment automation should verify behavior, not only configuration
- Cloudflare resource drift should be tracked explicitly

## 8. Compatibility

Current state:

- the project intentionally targets an OpenClaw-compatible subset
- several gateway and plugin methods already match the intended compatibility surface

What is missing:

- broader protocol coverage
- a precise boundary between supported, unsupported, and intentionally out-of-scope behavior
- compatibility validation against real client flows and plugin expectations

Why it matters:

- “compatible subset” is useful only if it is documented and testable
- plugin and client expectations will drift unless compatibility is verified continuously

Implementation concerns:

- compatibility work should be test-driven
- any unsupported features should fail clearly rather than partially working
