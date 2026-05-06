import { Type } from "@sinclair/typebox";
import type { ToolRuntime } from "./runtime";
import { ToolError } from "./runtime";

const maxResponseBytes = 64 * 1024;

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function assertUrlAllowed(url: URL, allowlist?: readonly string[]): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ToolError("WEB_FETCH_DENIED", "Only http and https URLs are allowed.");
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateIPv4(hostname)) {
    throw new ToolError("WEB_FETCH_DENIED", "Local and private network targets are denied.");
  }

  if (allowlist !== undefined && !allowlist.includes(hostname)) {
    throw new ToolError("WEB_FETCH_DENIED", `Hostname ${hostname} is not in the allowlist.`);
  }
}

export function webFetchTool(): ToolRuntime {
  return {
    name: "web_fetch",
    description: "Fetch a public HTTP(S) URL with SSRF checks and response caps.",
    inputSchema: Type.Object({
      url: Type.String({ minLength: 1 }),
    }),
    policy: { effects: ["network"] },
    async invoke(input, context) {
      const url = new URL((input as { url: string }).url);
      assertUrlAllowed(url, context.policy.webFetchAllowlist);
      const response = await (context.fetcher ?? fetch)(url);
      const text = await response.text();
      const capped = text.slice(0, maxResponseBytes);

      return {
        url: url.toString(),
        status: response.status,
        contentType: response.headers.get("content-type"),
        text: capped,
        truncated: text.length > capped.length,
      };
    },
  };
}
