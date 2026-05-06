export const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
} as const;

export function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...init?.headers,
    },
  });
}
