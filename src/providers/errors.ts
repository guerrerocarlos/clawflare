export const providerErrorCodes = [
  "PROVIDER_AUTH",
  "PROVIDER_BAD_MODEL_REF",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_REQUEST",
  "PROVIDER_RESPONSE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_INTERNAL",
] as const;

export type ProviderErrorCode = (typeof providerErrorCodes)[number];

export interface NormalizedProviderError {
  code: ProviderErrorCode;
  message: string;
  status?: number;
  retryable: boolean;
}

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function normalizeProviderError(error: unknown): NormalizedProviderError {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.status === undefined ? {} : { status: error.status }),
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    return {
      code: "PROVIDER_INTERNAL",
      message: error.message,
      retryable: false,
    };
  }

  return {
    code: "PROVIDER_INTERNAL",
    message: "Unknown provider error",
    retryable: false,
  };
}

export function providerHttpError(provider: string, response: Response): ProviderError {
  if (response.status === 401 || response.status === 403) {
    return new ProviderError("PROVIDER_AUTH", `${provider} rejected authentication.`, response.status, false);
  }

  if (response.status === 429) {
    return new ProviderError("PROVIDER_RATE_LIMIT", `${provider} rate limited the request.`, response.status, true);
  }

  if (response.status >= 500) {
    return new ProviderError("PROVIDER_UNAVAILABLE", `${provider} is unavailable.`, response.status, true);
  }

  return new ProviderError("PROVIDER_REQUEST", `${provider} request failed.`, response.status, false);
}
