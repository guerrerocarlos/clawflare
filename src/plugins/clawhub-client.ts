import { sha256Hex } from "../storage/keys";
import type { ClawHubPackage } from "./types";
import type { PluginRef } from "./resolver";

export interface ClawHubCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
}

export interface ClawHubClientOptions {
  baseUrl?: string;
  cache?: ClawHubCache;
  fetcher?: typeof fetch;
}

export class ClawHubClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ClawHubClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://clawhub.ai";
    this.fetcher = options.fetcher ?? fetch;
  }

  async search(query: string): Promise<ClawHubPackage[]> {
    const cacheKey = `clawhub:search:${await sha256Hex(query)}`;
    const cached = await this.options.cache?.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as ClawHubPackage[];
    }

    const response = await this.fetcher(`${this.baseUrl}/api/search?q=${encodeURIComponent(query)}`);

    if (!response.ok) {
      throw new Error(`ClawHub search failed with ${response.status}.`);
    }

    const payload = (await response.json()) as { packages?: ClawHubPackage[]; data?: ClawHubPackage[] };
    const packages = payload.packages ?? payload.data ?? [];
    await this.options.cache?.put(cacheKey, JSON.stringify(packages), { expirationTtl: 60 * 10 });
    return packages;
  }

  async inspect(ref: PluginRef): Promise<ClawHubPackage> {
    const url = new URL(`${this.baseUrl}/api/plugins/${encodeURIComponent(ref.name)}`);

    if (ref.version !== undefined) {
      url.searchParams.set("version", ref.version);
    }

    const response = await this.fetcher(url);

    if (!response.ok) {
      throw new Error(`ClawHub inspect failed with ${response.status}.`);
    }

    return (await response.json()) as ClawHubPackage;
  }
}
