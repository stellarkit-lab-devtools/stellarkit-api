const StellarKitError = require("./StellarKitError");

function configuredUrls(env, fallback) {
  const urls = (env.HORIZON_URLS || "").split(",").map((url) => url.trim()).filter(Boolean);
  const result = [...new Set(urls.length ? urls : [env.HORIZON_URL || fallback])];
  try {
    for (const value of result) {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
    }
  } catch {
    throw new Error("Invalid Horizon endpoint configuration. Use absolute HTTP(S) URLs.");
  }
  return result;
}

function retryable(error) {
  const status = error.response?.status ?? error.status;
  if (status) return status >= 500 && status <= 599;
  return ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
    "ECONNABORTED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "ERR_NETWORK", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]
    .includes(error.code || error.cause?.code) ||
    /timeout|timed out|fetch failed|network error|socket hang up|econnrefused|econnreset|enotfound/i.test(error.message || "") ||
    error.name === "AbortError" || error.name === "NetworkError";
}

// Never retain SDK request/config objects: they can contain URL credentials.
function safeError(error, urls) {
  error = error || {};
  const secrets = urls.flatMap((url) => {
    const { username, password } = new URL(url);
    return [username, password, decodeURIComponent(username), decodeURIComponent(password)].filter(Boolean);
  });
  const clean = (value) => {
    if (typeof value === "string") {
      let result = value.replace(/https?:\/\/[^\s/"<>]+@/gi, "https://[redacted]@");
      for (const secret of secrets) result = result.split(secret).join("[redacted]");
      return result;
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).filter(([key]) => !["config", "request", "authorization", "password", "username"].includes(key.toLowerCase())).map(([key, entry]) => [key, clean(entry)]),
    );
    return value;
  };
  const result = new Error(clean(error.message || "Horizon request failed."));
  result.code = error.code;
  result.status = error.status;
  if (error.response) result.response = { status: error.response.status, data: clean(error.response.data) };
  return result;
}

function createHorizonFailover({ urls, createServer, stickyMs = 60000, now = Date.now }) {
  const clients = urls.map(createServer);
  let active = 0;
  let stickyUntil = 0;

  async function request(operation) {
    const first = active !== 0 && now() < stickyUntil ? active : 0;
    for (let attempt = 0; attempt < clients.length; attempt++) {
      const index = (first + attempt) % clients.length;
      try {
        const result = await operation(clients[index], urls[index]);
        // A successful backup request must not extend the recovery deadline.
        if (index !== active || (index !== 0 && now() >= stickyUntil)) {
          stickyUntil = index === 0 ? 0 : now() + stickyMs;
        }
        active = index;
        return result;
      } catch (error) {
        if (!retryable(error)) throw safeError(error, urls);
      }
    }
    const error = new StellarKitError("Stellar Horizon is unavailable. Please try again.", 503, "UpstreamUnavailable");
    error.status = 503;
    throw error;
  }

  function replay(client, steps) {
    return steps.reduce((value, [method, args]) => value[method](...args), client);
  }

  // Record builder calls so each retry reconstructs the identical request on
  // another server. Streams deliberately stay on the configured primary.
  const asyncMethods = new Set(["loadAccount", "root", "serverInfo", "feeStats", "fetchBaseFee", "fetchTimebounds", "submitTransaction", "submitAsyncTransaction"]);
  function wrap(target, steps = [], run = request) {
    const overrides = new Map();
    return new Proxy(target, {
      get(object, property) {
        if (overrides.has(property)) return overrides.get(property);
        if (property === "then") return undefined;
        const value = object[property];
        if (typeof value !== "function") return value;
        if (!steps.length && asyncMethods.has(property)) {
          return (...args) => run((client) => client[property](...args));
        }
        return (...args) => {
          const next = [...steps, [property, args]];
          if (property === "stream") {
            const options = args[0] || {};
            const onerror = options.onerror;
            const streamArgs = [{ ...options, ...(onerror ? { onerror: (error) => onerror(safeError(error, urls)) } : {}) }, ...args.slice(1)];
            try { return replay(clients[0], [...steps, [property, streamArgs]]); }
            catch (error) { throw safeError(error, urls); }
          }
          if (steps.length || property === "call") {
            if (property === "call") return run((client) => replay(client, next));
            return wrap(replay(clients[0], next), next, run);
          }
          // Horizon's top-level async methods (loadAccount, feeStats, root,
          // submitTransaction) and its synchronous call-builder factories.
          return wrap(value.apply(object, args), next, run);
        };
      },
      // Preserve explicit method overrides, including the repository's usual
      // jest.spyOn(server, ...) mocks, without changing SDK client internals.
      set(_object, property, value) {
        overrides.set(property, value);
        return true;
      },
      deleteProperty(_object, property) {
        overrides.delete(property);
        return true;
      },
    });
  }

  const primaryRequest = async (operation) => {
    try { return await operation(clients[0], urls[0]); }
    catch (error) { throw safeError(error, urls); }
  };
  return {
    server: wrap(clients[0]),
    streamingServer: wrap(clients[0], [], primaryRequest),
    request,
    getActiveHost: () => new URL(urls[active]).host,
  };
}

module.exports = { configuredUrls, createHorizonFailover, retryable };
