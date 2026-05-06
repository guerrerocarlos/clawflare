import type { ClawflareEnv } from "../env";
import { getRuntimeDefaults } from "../env";

interface WebChatRunResponse {
  result?: {
    status: string;
    summary?: {
      outputText?: string;
    };
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function requireAuth(request: Request, env: ClawflareEnv): Response | null {
  const expected = env.CLAWFLARE_GATEWAY_TOKEN;
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;

  if (!expected || token !== expected) {
    return json({ ok: false, error: { code: "UNAUTHORIZED" } }, 401);
  }

  return null;
}

export async function handleWebChatMessage(request: Request, env: ClawflareEnv): Promise<Response> {
  const auth = requireAuth(request, env);

  if (auth) {
    return auth;
  }

  const body = (await request.json()) as { message?: string; sessionId?: string };

  if (!body.message) {
    return json({ ok: false, error: { code: "BAD_REQUEST", message: "message is required." } }, 400);
  }

  const defaults = getRuntimeDefaults(env);
  const id = env.AGENT_OBJECT.idFromName(`${defaults.accountId}:${defaults.agentId}`);
  const url = new URL(request.url);
  url.pathname = "/__clawflare/agent/openai-run";
  url.search = "";
  const response = await env.AGENT_OBJECT.get(id).fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: {
          session: {
            channel: "webchat",
            peerId: body.sessionId ?? "debug",
          },
          messages: [{ role: "user", content: body.message }],
        },
      }),
    }),
  );
  const payload = (await response.json()) as WebChatRunResponse;

  if (payload.result?.status !== "completed") {
    return json({ ok: false, error: { code: "AGENT_FAILED" } }, 502);
  }

  return json({
    ok: true,
    channel: "webchat",
    debugOnly: true,
    output: payload.result.summary?.outputText ?? "",
  });
}
