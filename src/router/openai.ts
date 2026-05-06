import type { ClawflareEnv } from "../env";
import type { AgentRunInput, AgentWaitResult } from "../agents/runtime";
import { getRuntimeDefaults } from "../env";
import { createDefaultProviderRegistry } from "../providers/registry";

interface OpenAiError {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

interface AgentObjectRunResponse {
  accepted: {
    runId: string;
  };
  result: AgentWaitResult;
}

function openAiJson(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });
}

function openAiError(message: string, status: number, code: string, type = "invalid_request_error"): Response {
  const payload: OpenAiError = {
    error: {
      message,
      type,
      code,
    },
  };

  return openAiJson(payload, { status });
}

function requireBearer(request: Request, env: ClawflareEnv): Response | null {
  const expected = env.CLAWFLARE_GATEWAY_TOKEN;

  if (!expected) {
    return openAiError("CLAWFLARE_GATEWAY_TOKEN is not configured.", 401, "UNAUTHORIZED", "authentication_error");
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;

  if (token !== expected) {
    return openAiError("Invalid bearer token.", 401, "UNAUTHORIZED", "authentication_error");
  }

  return null;
}

function getAgentObjectStub(env: ClawflareEnv): DurableObjectStub {
  const defaults = getRuntimeDefaults(env);
  const id = env.AGENT_OBJECT.idFromName(`${defaults.accountId}:${defaults.agentId}`);
  return env.AGENT_OBJECT.get(id);
}

function asStringContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("");
  }

  return "";
}

function parseChatMessages(body: Record<string, unknown>): AgentRunInput["messages"] | Response {
  if (!Array.isArray(body.messages)) {
    return openAiError("messages must be an array.", 400, "BAD_REQUEST");
  }

  return body.messages.map((message) => {
    if (typeof message !== "object" || message === null) {
      return { role: "user", content: "" };
    }

    const item = message as Record<string, unknown>;
    const role = typeof item.role === "string" ? item.role : "user";

    return {
      role: role === "assistant" || role === "system" || role === "tool" ? role : "user",
      content: asStringContent(item.content),
    };
  });
}

function parseResponsesInput(body: Record<string, unknown>): AgentRunInput["messages"] | Response {
  if (typeof body.input === "string") {
    return [{ role: "user", content: body.input }];
  }

  if (Array.isArray(body.input)) {
    return body.input.map((message) => {
      if (typeof message !== "object" || message === null) {
        return { role: "user", content: "" };
      }

      const item = message as Record<string, unknown>;
      const role = typeof item.role === "string" ? item.role : "user";

      return {
        role: role === "assistant" || role === "system" || role === "tool" ? role : "user",
        content: asStringContent(item.content),
      };
    });
  }

  return openAiError("input must be a string or message array.", 400, "BAD_REQUEST");
}

async function invokeAgentObject(request: Request, env: ClawflareEnv, input: AgentRunInput): Promise<AgentObjectRunResponse> {
  const url = new URL(request.url);
  url.pathname = "/__clawflare/agent/openai-run";
  url.search = "";
  const response = await getAgentObjectStub(env).fetch(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ input }),
    }),
  );

  if (!response.ok) {
    throw new Error(`AgentObject returned ${response.status}`);
  }

  return (await response.json()) as AgentObjectRunResponse;
}

function completionId(runId: string): string {
  return `chatcmpl-${runId}`;
}

function responseId(runId: string): string {
  return `resp_${runId}`;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function providerFailure(result: AgentWaitResult): Response | null {
  if (result.status === "completed") {
    return null;
  }

  return openAiError("Agent run failed.", 502, "PROVIDER_FAILURE", "server_error");
}

export async function handleModelsList(request: Request, env: ClawflareEnv): Promise<Response> {
  const auth = requireBearer(request, env);

  if (auth) {
    return auth;
  }

  const registry = createDefaultProviderRegistry();
  const models = await registry.listModels(env, fetch);

  return openAiJson({
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created: model.created ?? 0,
      owned_by: model.provider,
    })),
  });
}

export async function handleModelGet(request: Request, env: ClawflareEnv, modelId: string): Promise<Response> {
  const auth = requireBearer(request, env);

  if (auth) {
    return auth;
  }

  const registry = createDefaultProviderRegistry();
  const models = await registry.listModels(env, fetch);
  const model = models.find((candidate) => candidate.id === modelId);

  if (!model) {
    return openAiError(`Model ${modelId} was not found.`, 404, "MODEL_NOT_FOUND");
  }

  return openAiJson({
    id: model.id,
    object: "model",
    created: model.created ?? 0,
    owned_by: model.provider,
  });
}

export async function handleChatCompletions(request: Request, env: ClawflareEnv): Promise<Response> {
  const auth = requireBearer(request, env);

  if (auth) {
    return auth;
  }

  const body = (await request.json()) as Record<string, unknown>;

  if (body.stream === true) {
    return openAiError("Streaming chat completions are not implemented in the MVP.", 400, "NOT_IMPLEMENTED");
  }

  const messages = parseChatMessages(body);

  if (messages instanceof Response) {
    return messages;
  }

  const model = typeof body.model === "string" ? body.model : "fake/deterministic";
  const agentResponse = await invokeAgentObject(request, env, {
    session: { channel: "openai-http", peerId: "default" },
    messages,
    model,
  });
  const failure = providerFailure(agentResponse.result);

  if (failure) {
    return failure;
  }

  return openAiJson({
    id: completionId(agentResponse.accepted.runId),
    object: "chat.completion",
    created: unixNow(),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: agentResponse.result.summary?.outputText ?? "",
        },
        finish_reason: "stop",
      },
    ],
    usage: agentResponse.result.summary?.usage ?? {},
  });
}

export async function handleResponses(request: Request, env: ClawflareEnv): Promise<Response> {
  const auth = requireBearer(request, env);

  if (auth) {
    return auth;
  }

  const body = (await request.json()) as Record<string, unknown>;

  if (body.stream === true) {
    return openAiError("Streaming responses are not implemented in the MVP.", 400, "NOT_IMPLEMENTED");
  }

  const messages = parseResponsesInput(body);

  if (messages instanceof Response) {
    return messages;
  }

  const model = typeof body.model === "string" ? body.model : "fake/deterministic";
  const agentResponse = await invokeAgentObject(request, env, {
    session: { channel: "openai-http", peerId: "default" },
    messages,
    model,
  });
  const failure = providerFailure(agentResponse.result);

  if (failure) {
    return failure;
  }

  return openAiJson({
    id: responseId(agentResponse.accepted.runId),
    object: "response",
    created_at: unixNow(),
    status: "completed",
    model,
    output: [
      {
        id: `msg_${agentResponse.accepted.runId}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: agentResponse.result.summary?.outputText ?? "",
          },
        ],
      },
    ],
    usage: agentResponse.result.summary?.usage ?? {},
  });
}
