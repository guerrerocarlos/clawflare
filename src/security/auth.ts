import type { ClawflareEnv } from "../env";

export type AuthScope = "read" | "write" | "admin";

export interface AuthPrincipal {
  role: "operator";
  scopes: AuthScope[];
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function authenticateBearer(request: Request, env: ClawflareEnv): AuthPrincipal {
  const expected = env.CLAWFLARE_GATEWAY_TOKEN;
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;

  if (!expected || token !== expected) {
    throw new AuthError("Invalid bearer token.", 401);
  }

  return {
    role: "operator",
    scopes: ["read", "write", "admin"],
  };
}

export function requireScopes(principal: AuthPrincipal, scopes: AuthScope[]): void {
  for (const scope of scopes) {
    if (!principal.scopes.includes(scope)) {
      throw new AuthError(`Missing required scope ${scope}.`, 403);
    }
  }
}
