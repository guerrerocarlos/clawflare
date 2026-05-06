import type { ClawflareEnv } from "../env";
import { authenticateBearer } from "../security/auth";
import { runDoctor } from "../cli/doctor";

export async function handleDoctor(request: Request, env: ClawflareEnv): Promise<Response> {
  try {
    authenticateBearer(request, env);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify(await runDoctor(env)), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
