const StellarKitError = require("./StellarKitError");

function configuredUrls(env, fallback) {
  const urls = (env.HORIZON_URLS || "").split(",").map((url) => url.trim()).filter(Boolean);
  return [...new Set(urls.length ? urls : [env.HORIZON_URL || fallback])];
}

function retryable(error) {
  const status = error.response?.status ?? error.status;
  if (status) return status >= 500 && status <= 599;
  return ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
    "ECONNABORTED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]
    .includes(error.code || error.cause?.code) ||
    /timeout|timed out|fetch failed/i.test(error.message || "") || error.name === "AbortError";
}

// Never retain SDK request/config objects: they can contain URL credentials.
function safeError(error) {
  const clean = (value) => {
    if (typeof value === "string") return value.replace(/https?:\/\/[^\s/"<>]+@/gi, "https://[redacted]@");
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
        if (!retryable(error)) throw safeError(error);
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
  function wrap(target, steps = []) {
    return new Proxy(target, {
      get(object, property) {
        if (property === "then") return undefined;
        const value = object[property];
        if (typeof value !== "function") return value;
        return (...args) => {
          const next = [...steps, [property, args]];
          if (property === "stream") return replay(clients[0], next);
          if (steps.length || property === "call") {
            if (property === "call") return request((client) => replay(client, next));
            return wrap(replay(clients[0], next), next);
          }
          // Horizon's top-level async methods (loadAccount, feeStats, root,
          // submitTransaction) and its synchronous call-builder factories.
          return wrap(value.apply(object, args), next);
        };
      },
    });
  }

  const asyncMethods = new Set(["loadAccount", "root", "serverInfo", "feeStats", "fetchBaseFee", "fetchTimebounds", "submitTransaction", "submitAsyncTransaction"]);
  const builders = wrap(clients[0]);
  const server = new Proxy(builders, {
    get(target, property) {
      if (asyncMethods.has(property)) return (...args) => request((client) => client[property](...args));
      return target[property];
    },
  });

  return { server, request, getActiveHost: () => new URL(urls[active]).host };
}

module.exports = { configuredUrls, createHorizonFailover, retryable };
