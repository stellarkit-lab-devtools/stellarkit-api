import { StellarKitError } from "./errors";

export interface RiskScore {
  score: number;
  level: "low" | "medium" | "high";
  factors: string[];
  computedAt: string;
}

export interface AccountClientConfig {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export class AccountClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AccountClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch ?? fetch;
  }

  async getRiskScore(id: string): Promise<RiskScore> {
    const url = `${this.baseUrl}/account/${encodeURIComponent(id)}/risk-score`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });
    } catch (cause) {
      throw new StellarKitError(
        `Failed to fetch risk score for account ${id}`,
        { code: "NETWORK_ERROR", cause },
      );
    }

    if (!response.ok) {
      throw new StellarKitError(
        `Failed to fetch risk score for account ${id}: ${response.status}`,
        { code: "HTTP_ERROR", status: response.status },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new StellarKitError(
        `Invalid risk score response for account ${id}`,
        { code: "PARSE_ERROR", cause },
      );
    }

    return mapRiskScore(payload, id);
  }
}

function mapRiskScore(payload: unknown, id: string): RiskScore {
  if (typeof payload !== "object" || payload === null) {
    throw new StellarKitError(
      `Invalid risk score response for account ${id}`,
      { code: "PARSE_ERROR" },
    );
  }

  const data = payload as Record<string, unknown>;
  const { score, level, factors, computedAt } = data;

  if (typeof score !== "number") {
    throw new StellarKitError(
      `Invalid risk score response for account ${id}: missing score`,
      { code: "PARSE_ERROR" },
    );
  }

  if (level !== "low" && level !== "medium" && level !== "high") {
    throw new StellarKitError(
      `Invalid risk score response for account ${id}: invalid level`,
      { code: "PARSE_ERROR" },
    );
  }

  if (!Array.isArray(factors) || !factors.every((f) => typeof f === "string")) {
    throw new StellarKitError(
      `Invalid risk score response for account ${id}: invalid factors`,
      { code: "PARSE_ERROR" },
    );
  }

  if (typeof computedAt !== "string") {
    throw new StellarKitError(
      `Invalid risk score response for account ${id}: missing computedAt`,
      { code: "PARSE_ERROR" },
    );
  }

  return {
    score,
    level,
    factors,
    computedAt,
  };
}
