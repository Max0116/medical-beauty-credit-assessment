export type OfficialRegistryCandidate = {
  name: string;
  creditCode: string;
  registrationStatus: string;
  legalRepresentative: string;
  registeredAddress: string;
  businessScope: string;
  source: string;
  sourceUrl: string;
};

export type OfficialRegistryResult = {
  provider: string;
  status: "unconfigured" | "completed" | "failed" | "empty";
  message: string;
  candidates: OfficialRegistryCandidate[];
  rawResult?: unknown;
};

export type OfficialRegistryConfig = {
  endpoint: string;
  apiKey: string;
  provider: string;
  authHeaderName: string;
  authHeaderPrefix: string;
};

export function createOfficialRegistryConfig(env: {
  endpoint?: string;
  apiKey?: string;
  provider?: string;
  authHeaderName?: string;
  authHeaderPrefix?: string;
}): OfficialRegistryConfig {
  return {
    endpoint: String(env.endpoint || "").trim(),
    apiKey: String(env.apiKey || "").trim(),
    provider: String(env.provider || "official_registry").trim() || "official_registry",
    authHeaderName: String(env.authHeaderName || "Authorization").trim() || "Authorization",
    authHeaderPrefix: String(env.authHeaderPrefix || "Bearer").trim()
  };
}

export async function queryOfficialRegistry({
  config,
  institutionName,
  creditCode,
  clientInstanceId,
  fetchImpl = fetch
}: {
  config: OfficialRegistryConfig;
  institutionName: string;
  creditCode?: string;
  clientInstanceId: string;
  fetchImpl?: typeof fetch;
}): Promise<OfficialRegistryResult> {
  if (!config.endpoint) {
    return {
      provider: config.provider,
      status: "unconfigured",
      message: "未配置官方企业信用接口",
      candidates: []
    };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-client-instance-id": clientInstanceId.slice(0, 128)
    };
    if (config.apiKey) {
      headers[config.authHeaderName] = config.authHeaderPrefix
        ? `${config.authHeaderPrefix} ${config.apiKey}`
        : config.apiKey;
    }

    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        keyword: creditCode || institutionName,
        institutionName,
        creditCode: creditCode || ""
      })
    });

    if (!response.ok) {
      throw new Error(`Official registry lookup failed with status ${response.status}`);
    }

    const payload = await response.json();
    const candidates = normalizeOfficialRegistryCandidates(payload, config.provider);
    return {
      provider: config.provider,
      status: candidates.length ? "completed" : "empty",
      message: candidates.length ? "官方企业信用接口已返回候选" : "官方企业信用接口未返回匹配候选",
      candidates,
      rawResult: payload
    };
  } catch (error) {
    return {
      provider: config.provider,
      status: "failed",
      message: error instanceof Error ? error.message : "官方企业信用接口查询失败",
      candidates: []
    };
  }
}

export function normalizeOfficialRegistryCandidates(payload: unknown, provider: string): OfficialRegistryCandidate[] {
  const records = findRecordArray(payload);
  const seen = new Set<string>();

  return records
    .map((record) => normalizeOfficialRegistryCandidate(record, provider))
    .filter((candidate) => candidate.name || candidate.creditCode)
    .filter((candidate) => {
      const key = candidate.creditCode || candidate.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function findRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  const directKeys = ["records", "items", "list", "results", "data"];
  for (const key of directKeys) {
    const child = value[key];
    if (Array.isArray(child)) return child.filter(isRecord);
    if (isRecord(child)) {
      const nested = findRecordArray(child);
      if (nested.length) return nested;
    }
  }

  return [value];
}

function normalizeOfficialRegistryCandidate(record: Record<string, unknown>, provider: string): OfficialRegistryCandidate {
  const name = firstString(record, ["name", "enterpriseName", "companyName", "entName", "orgName"]);
  const creditCode = firstString(record, [
    "creditCode",
    "unifiedSocialCreditCode",
    "socialCreditCode",
    "uscc",
    "regNo",
    "taxNo"
  ]).toUpperCase();

  return {
    name,
    creditCode,
    registrationStatus: firstString(record, ["registrationStatus", "status", "regStatus", "operatingStatus"]),
    legalRepresentative: firstString(record, ["legalRepresentative", "legalPerson", "frName", "legalPersonName"]),
    registeredAddress: firstString(record, ["registeredAddress", "address", "dom", "regLocation"]),
    businessScope: firstString(record, ["businessScope", "scope", "opScope"]),
    source: firstString(record, ["source", "provider"]) || provider,
    sourceUrl: firstString(record, ["sourceUrl", "url", "detailUrl"])
  };
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
