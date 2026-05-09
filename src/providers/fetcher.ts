import type { ProviderFetch } from "./runtime";

export function createProviderFetch(): ProviderFetch {
  return (input, init) => globalThis.fetch(input, init);
}
