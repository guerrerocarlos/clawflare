import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import { selectDefaultAgentProvider } from "../src/providers/defaults";

describe("default agent provider selection", () => {
  it("prefers OpenAI-compatible when OPENAI_API_KEY is configured", () => {
    const provider = selectDefaultAgentProvider({
      OPENAI_API_KEY: "secret",
      OPENAI_COMPATIBLE_BASE_URL: "https://openrouter.ai/api/v1",
    } as ClawflareEnv);

    expect(provider.id).toBe("openai-compatible");
  });

  it("uses Workers AI when a Cloudflare model is configured", () => {
    const provider = selectDefaultAgentProvider({
      AI: {} as Ai,
      CLAWFLARE_DEFAULT_MODEL: "@cf/meta/llama-3.1-8b-instruct",
    } as ClawflareEnv);

    expect(provider.id).toBe("workers-ai");
  });

  it("falls back to fake when no real provider is configured", () => {
    const provider = selectDefaultAgentProvider({} as ClawflareEnv);

    expect(provider.id).toBe("fake");
  });
});
