export interface FetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<any>;
}

export type FetchFunction = (
  input: string,
  init?: FetchRequestInit,
) => Promise<FetchResponse>;

export class StellarKitConfigurationError extends Error {
  constructor(message = "A fetch implementation is required. Pass one with the fetch option.") {
    super(message);
    this.name = "StellarKitConfigurationError";
  }
}

export class StellarKitNetworkError extends Error {
  readonly type = "NetworkError";
  readonly cause: unknown;

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    super(`Network request failed${detail}`);
    this.name = "StellarKitNetworkError";
    this.cause = cause;
  }
}

export function resolveFetch(fetchImplementation?: FetchFunction): FetchFunction {
  const globalFetch = (globalThis as typeof globalThis & {
    fetch?: FetchFunction;
  }).fetch;
  const resolvedFetch = fetchImplementation ?? globalFetch;
  if (typeof resolvedFetch !== "function") {
    throw new StellarKitConfigurationError();
  }
  return resolvedFetch;
}

export async function request(
  fetchImplementation: FetchFunction,
  url: string,
  init?: FetchRequestInit,
): Promise<FetchResponse> {
  try {
    return await fetchImplementation(url, init);
  } catch (error) {
    throw new StellarKitNetworkError(error);
  }
}
