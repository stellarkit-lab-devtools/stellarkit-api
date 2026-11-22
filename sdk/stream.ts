/**
 * StreamClient — typed, auto-reconnecting helpers for the StellarKit
 * streaming endpoints:
 *
 *   - SSE  GET /stream/payments/:id
 *   - SSE  GET /stream/transactions/:id
 *   - WS       /stream/ledgers
 *
 * Every helper returns `{ close() }` and accepts `onMessage`, `onError`,
 * `onOpen` and an optional `AbortSignal`. Dropped connections are retried
 * with exponential backoff plus jitter (bounded by `maxRetries`), a
 * `heartbeatMs` watchdog forces a reconnect when the server goes silent, and
 * every reconnect resumes from the last received event via `?cursor=` so no
 * events are duplicated or skipped.
 *
 * This module is self-contained (no runtime imports) so it works in Node 18+
 * and modern browsers.
 *
 * @example
 * ```ts
 * const sub = client.stream.payments("GABC...", {
 *   onMessage: (payment) => console.log(payment.amount, payment.asset.code),
 *   onError: (err) => console.warn(err.code, err.message, err.willRetry),
 *   heartbeatMs: 60_000,
 * });
 * // later
 * sub.close();
 * ```
 */

// ── Event payload types ──────────────────────────────────────────────────────

/** Standard StellarKit asset shape. */
export interface StreamAsset {
  code: string;
  issuer: string | null;
  type: string;
}

/** Payload of an `event: payment` from GET /stream/payments/:id. */
export interface PaymentStreamEvent {
  type: "payment" | "create_account";
  amount: string | null;
  asset: StreamAsset;
  from: string | null;
  to: string | null;
  timestamp: string | null;
  /** Horizon paging token; used to resume the stream. */
  cursor: string | null;
}

/** Payload of an `event: transaction` from GET /stream/transactions/:id. */
export interface TransactionStreamEvent {
  id: string;
  hash: string;
  ledger: number;
  createdAt: string | null;
  sourceAccount: string;
  feeCharged: string;
  operationCount: number;
  envelopeXdr: string;
  resultXdr: string;
  resultMetaXdr: string;
  memoType: string;
  memo: string | null;
  successful: boolean;
  /** Horizon paging token; used to resume the stream. */
  cursor: string | null;
  [key: string]: unknown;
}

/** Message from WS /stream/ledgers. */
export interface LedgerStreamEvent {
  sequence: number;
  closedAt: string;
  baseFee: number;
  transactionCount: number;
  /** Ledger paging token; used to resume the stream. */
  cursor?: string;
}

// ── Options / handles ────────────────────────────────────────────────────────

export type StreamErrorCode =
  | "HTTP_ERROR"
  | "CONNECTION_LOST"
  | "STREAM_ENDED"
  | "SERVER_ERROR"
  | "HEARTBEAT_TIMEOUT"
  | "MAX_RETRIES_EXCEEDED"
  | "CALLBACK_ERROR"
  | "UNSUPPORTED";

/** Error passed to `onError`. */
export class StreamError extends Error {
  /** Machine-readable reason. */
  readonly code: StreamErrorCode;
  /** HTTP status when the server rejected the connection. */
  readonly status?: number;
  /** Whether the client will reconnect after this error. */
  willRetry: boolean;
  /** The underlying error, when one exists. */
  readonly cause?: unknown;

  constructor(
    message: string,
    code: StreamErrorCode,
    extra: { status?: number; cause?: unknown; willRetry?: boolean } = {},
  ) {
    super(message);
    this.name = "StreamError";
    this.code = code;
    this.status = extra.status;
    this.cause = extra.cause;
    this.willRetry = extra.willRetry ?? false;
  }
}

export interface StreamOptions<T> {
  /** Called once per event, in order, with no duplicates across reconnects. */
  onMessage: (event: T) => void;
  /** Called for every connection failure; `error.willRetry` says whether a reconnect follows. */
  onError?: (error: StreamError) => void;
  /** Called each time a connection (or reconnection) is established. */
  onOpen?: () => void;
  /** Aborting the signal closes the stream and stops all retries. */
  signal?: AbortSignal;
  /** Cursor to start from. Defaults to the live edge ("now"). */
  cursor?: string;
  /** Maximum consecutive reconnect attempts before giving up (default 10). */
  maxRetries?: number;
  /** First backoff delay in ms (default 1000). Doubles on each attempt. */
  initialDelayMs?: number;
  /** Upper bound for the backoff delay in ms (default 30000). */
  maxDelayMs?: number;
  /**
   * Force a reconnect when nothing (events or server keep-alives) arrives in
   * this many ms. Disabled when omitted or 0.
   */
  heartbeatMs?: number;
  /** Random source in [0, 1) used for jitter. Defaults to Math.random. */
  random?: () => number;
}

export interface StreamHandle {
  /** Close the connection and cancel any pending reconnect. Idempotent. */
  close(): void;
}

/** Minimal WebSocket constructor contract (browser WebSocket or the `ws` package). */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: unknown }) => void) | null;
  close(code?: number, reason?: string): void;
}
export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface StreamClientConfig {
  baseUrl: string;
  apiKey?: string;
  /** fetch implementation used for SSE streams. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** WebSocket implementation used for WS streams. Defaults to global WebSocket. */
  WebSocket?: WebSocketConstructor;
}

// ── Backoff ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;

/**
 * Exponential backoff with "equal jitter": the capped exponential delay is
 * split in half, one half fixed and the other randomised, so retries never
 * fire immediately but concurrent clients still spread out.
 *
 * delay(attempt) ∈ [base / 2, base), base = min(maxDelayMs, initialDelayMs · 2^attempt)
 *
 * @param attempt - Zero-based retry attempt.
 */
export function computeBackoffDelay(
  attempt: number,
  options: Pick<StreamOptions<unknown>, "initialDelayMs" | "maxDelayMs" | "random"> = {},
): number {
  const initial = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  const base = Math.min(max, initial * Math.pow(2, Math.max(0, attempt)));
  return Math.round(base / 2 + random() * (base / 2));
}

// ── Reconnecting engine ──────────────────────────────────────────────────────

interface ConnectionHandlers<T> {
  open(): void;
  /** Any bytes/messages from the server, including keep-alives. */
  activity(): void;
  message(event: T, cursor: string | null): void;
  fail(error: StreamError, fatal?: boolean): void;
}

interface Connection {
  close(): void;
}

type Connector<T> = (cursor: string | undefined, handlers: ConnectionHandlers<T>) => Connection;

function toStreamError(err: unknown, code: StreamErrorCode = "CONNECTION_LOST"): StreamError {
  if (err instanceof StreamError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new StreamError(message || "Connection lost", code, { cause: err });
}

function runStream<T>(connector: Connector<T>, options: StreamOptions<T>): StreamHandle {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const heartbeatMs = options.heartbeatMs ?? 0;
  const signal = options.signal;

  let closed = false;
  let attempt = 0;
  let generation = 0;
  let lastCursor: string | undefined = options.cursor;
  let connection: Connection | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    retryTimer = null;
    heartbeatTimer = null;
  };

  const dropConnection = () => {
    const current = connection;
    connection = null;
    if (current) {
      try {
        current.close();
      } catch {
        // ignore teardown errors
      }
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    generation++;
    clearTimers();
    dropConnection();
    if (signal) signal.removeEventListener("abort", close);
  };

  const emitError = (error: StreamError) => {
    if (!options.onError) return;
    try {
      options.onError(error);
    } catch {
      // never let a user callback break the retry loop
    }
  };

  const armHeartbeat = (gen: number) => {
    if (!heartbeatMs || heartbeatMs <= 0) return;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      if (closed || gen !== generation) return;
      handleFailure(
        gen,
        new StreamError(`No events received within ${heartbeatMs} ms`, "HEARTBEAT_TIMEOUT"),
      );
    }, heartbeatMs);
  };

  const handleFailure = (gen: number, error: StreamError, fatal = false) => {
    if (closed || gen !== generation) return;
    generation++; // ignore anything the failed connection still emits
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
    dropConnection();

    if (fatal) {
      error.willRetry = false;
      emitError(error);
      close();
      return;
    }

    if (attempt >= maxRetries) {
      emitError(
        new StreamError(
          `Gave up after ${maxRetries} reconnect attempt(s): ${error.message}`,
          "MAX_RETRIES_EXCEEDED",
          { status: error.status, cause: error },
        ),
      );
      close();
      return;
    }

    error.willRetry = true;
    emitError(error);
    if (closed) return; // onError may have called close()

    const delay = computeBackoffDelay(attempt, options);
    attempt++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closed) return;
    const gen = ++generation;
    const live = () => !closed && gen === generation;

    connection = connector(lastCursor, {
      open: () => {
        if (!live()) return;
        armHeartbeat(gen);
        if (options.onOpen) {
          try {
            options.onOpen();
          } catch {
            // ignore
          }
        }
      },
      activity: () => {
        if (live()) armHeartbeat(gen);
      },
      message: (event, cursor) => {
        if (!live()) return;
        // Servers resume *after* the cursor, but guard against a replay of
        // the last delivered event anyway.
        if (cursor !== null && cursor === lastCursor) return;
        if (cursor !== null) lastCursor = cursor;
        attempt = 0; // a delivered event means the connection is healthy
        armHeartbeat(gen);
        try {
          options.onMessage(event);
        } catch (err) {
          emitError(
            new StreamError(
              `onMessage threw: ${err instanceof Error ? err.message : String(err)}`,
              "CALLBACK_ERROR",
              { cause: err, willRetry: true },
            ),
          );
        }
      },
      fail: (error, fatal) => handleFailure(gen, error, fatal),
    });

    // Also watch the connecting phase so a hung handshake is retried.
    armHeartbeat(gen);
  };

  if (signal) {
    if (signal.aborted) {
      closed = true;
      return { close: () => undefined };
    }
    signal.addEventListener("abort", close, { once: true });
  }

  connect();
  return { close };
}

// ── SSE transport ────────────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

/** Incremental text/event-stream parser. */
function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = "";
  let eventName = "";
  let data: string[] = [];
  let id: string | null = null;

  const dispatch = () => {
    if (data.length > 0) {
      onEvent({ event: eventName || "message", data: data.join("\n"), id });
    }
    eventName = "";
    data = [];
    id = null;
  };

  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        dispatch();
        continue;
      }
      if (line.startsWith(":")) continue; // comment / keep-alive
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") eventName = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }
  };
}

function sseConnector<T extends { cursor?: string | null }>(config: {
  fetchImpl: typeof fetch;
  buildUrl: (cursor: string | undefined) => string;
  headers: Record<string, string>;
  eventName: string;
}): Connector<T> {
  return (cursor, handlers) => {
    const controller = new AbortController();
    let done = false;

    (async () => {
      let response: Response;
      try {
        response = await config.fetchImpl(config.buildUrl(cursor), {
          method: "GET",
          headers: { Accept: "text/event-stream", ...config.headers },
          signal: controller.signal,
        });
      } catch (err) {
        if (!done) handlers.fail(toStreamError(err));
        return;
      }

      if (!response.ok) {
        let message = response.statusText || `HTTP ${response.status}`;
        try {
          const body = await response.json();
          message = (body && body.error && body.error.message) || message;
        } catch {
          // non-JSON body
        }
        // Client errors (bad ID, unknown account, bad cursor) will not fix
        // themselves on retry; timeouts and rate limits might.
        const fatal =
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429;
        if (!done) {
          handlers.fail(new StreamError(message, "HTTP_ERROR", { status: response.status }), fatal);
        }
        return;
      }

      if (!response.body || typeof response.body.getReader !== "function") {
        if (!done) {
          handlers.fail(
            new StreamError("This fetch implementation does not support streaming bodies", "UNSUPPORTED"),
            true,
          );
        }
        return;
      }

      handlers.open();

      const parse = createSseParser((evt) => {
        if (done) return;
        if (evt.event === "error") {
          let message = "Server reported a stream error";
          try {
            message = JSON.parse(evt.data).message || message;
          } catch {
            // keep default
          }
          handlers.fail(new StreamError(message, "SERVER_ERROR"));
          return;
        }
        if (evt.event !== config.eventName) return; // connected / heartbeat
        let payload: T;
        try {
          payload = JSON.parse(evt.data) as T;
        } catch {
          return;
        }
        const eventCursor = evt.id || (payload && payload.cursor) || null;
        handlers.message(payload, eventCursor === null ? null : String(eventCursor));
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done: ended } = await reader.read();
          if (ended || done) break;
          handlers.activity();
          parse(decoder.decode(value, { stream: true }));
        }
        if (!done) handlers.fail(new StreamError("Stream ended by server", "STREAM_ENDED"));
      } catch (err) {
        if (!done) handlers.fail(toStreamError(err));
      }
    })();

    return {
      close() {
        done = true;
        controller.abort();
      },
    };
  };
}

// ── WebSocket transport ──────────────────────────────────────────────────────

function wsConnector<T extends { cursor?: string | null }>(config: {
  WebSocketImpl: WebSocketConstructor;
  buildUrl: (cursor: string | undefined) => string;
}): Connector<T> {
  return (cursor, handlers) => {
    let done = false;
    let socket: WebSocketLike;
    try {
      socket = new config.WebSocketImpl(config.buildUrl(cursor));
    } catch (err) {
      setTimeout(() => {
        if (!done) handlers.fail(toStreamError(err));
      }, 0);
      return { close: () => { done = true; } };
    }

    socket.onopen = () => {
      if (!done) handlers.open();
    };
    socket.onmessage = (ev) => {
      if (done) return;
      handlers.activity();
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
      let payload: T;
      try {
        payload = JSON.parse(raw) as T;
      } catch {
        return;
      }
      const eventCursor = payload && payload.cursor != null ? String(payload.cursor) : null;
      handlers.message(payload, eventCursor);
    };
    socket.onerror = () => {
      // A close event always follows; handle the failure there.
    };
    socket.onclose = (ev) => {
      if (done) return;
      const code = ev && typeof ev.code === "number" ? ev.code : undefined;
      // 1008 = policy violation (e.g. invalid cursor): retrying will not help.
      handlers.fail(
        new StreamError(`WebSocket closed${code ? ` (code ${code})` : ""}`, "CONNECTION_LOST"),
        code === 1008,
      );
    };

    return {
      close() {
        done = true;
        try {
          socket.close(1000, "client closed");
        } catch {
          // ignore
        }
      },
    };
  };
}

// ── Public client ────────────────────────────────────────────────────────────

function withCursor(url: string, cursor: string | undefined): string {
  return cursor ? `${url}?cursor=${encodeURIComponent(cursor)}` : url;
}

/**
 * Typed streaming helpers. Available as `client.stream` on StellarKitClient,
 * or standalone via `new StreamClient({ baseUrl })`.
 */
export class StreamClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly WebSocketImpl?: WebSocketConstructor;

  constructor(config: StreamClientConfig) {
    if (!config || !config.baseUrl) {
      throw new Error("baseUrl is required");
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch;
    this.WebSocketImpl = config.WebSocket;
  }

  /** Live payments (payment, create_account) for an account via SSE. */
  payments(accountId: string, options: StreamOptions<PaymentStreamEvent>): StreamHandle {
    return this.sse<PaymentStreamEvent>(
      `/stream/payments/${encodeURIComponent(accountId)}`,
      "payment",
      options,
    );
  }

  /** Live transactions for an account via SSE. */
  transactions(accountId: string, options: StreamOptions<TransactionStreamEvent>): StreamHandle {
    return this.sse<TransactionStreamEvent>(
      `/stream/transactions/${encodeURIComponent(accountId)}`,
      "transaction",
      options,
    );
  }

  /** Live ledger closes via the WS /stream/ledgers WebSocket. */
  ledgers(options: StreamOptions<LedgerStreamEvent>): StreamHandle {
    const WebSocketImpl =
      this.WebSocketImpl ??
      ((globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket);
    if (!WebSocketImpl) {
      throw new Error(
        "No WebSocket implementation available. Pass { WebSocket } (e.g. from the 'ws' package) to the client.",
      );
    }
    const wsBase = this.baseUrl.replace(/^http/i, "ws");
    return runStream(
      wsConnector<LedgerStreamEvent>({
        WebSocketImpl,
        buildUrl: (cursor) => withCursor(`${wsBase}/stream/ledgers`, cursor),
      }),
      options,
    );
  }

  private sse<T extends { cursor?: string | null }>(
    path: string,
    eventName: string,
    options: StreamOptions<T>,
  ): StreamHandle {
    const fetchImpl = this.fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new Error("No fetch implementation available. Pass { fetch } to the client.");
    }
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    return runStream(
      sseConnector<T>({
        fetchImpl,
        buildUrl: (cursor) => withCursor(`${this.baseUrl}${path}`, cursor),
        headers,
        eventName,
      }),
      options,
    );
  }
}
