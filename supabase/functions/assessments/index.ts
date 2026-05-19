import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type AssessmentRecord = {
  id: string;
  institutionName: string;
  finalGrade: string;
  finalDecision: string;
  totalScore: number;
  maxTermDays: number;
  suggestedLimit: number;
  stableMonthlyAverage: number;
  needsApproval: boolean;
  redlineReasons: string[];
  capReasons: string[];
  approvalReasons: string[];
  createdAt: string;
  updatedAt: string;
  form: Record<string, unknown>;
  result: Record<string, unknown>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SECRET_KEYS = safeJson<Record<string, string>>(Deno.env.get("SUPABASE_SECRET_KEYS"), {});
const SUPABASE_PUBLISHABLE_KEYS = safeJson<Record<string, string>>(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), {});
const SERVICE_ROLE_KEY = SUPABASE_SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const LEGACY_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const ZHIPUAI_API_KEY = Deno.env.get("ZHIPUAI_API_KEY") || "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  const corsHeaders = getCorsHeaders(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    validateRequest(request, origin);
    const clientInstanceId = validateClientInstanceId(request.headers.get("x-client-instance-id"));
    const { resource, id } = parseRoute(new URL(request.url));

    if (resource === "draft") {
      return await handleDraft(request, clientInstanceId, corsHeaders);
    }

    if (resource === "records") {
      return await handleRecords(request, clientInstanceId, id, corsHeaders);
    }

    return json({ error: "Not found" }, 404, corsHeaders);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400, corsHeaders);
  }
});

async function handleDraft(request: Request, clientInstanceId: string, corsHeaders: HeadersInit) {
  if (request.method === "GET") {
    const { data, error } = await supabase
      .from("assessment_drafts")
      .select("form_snapshot")
      .eq("client_instance_id", clientInstanceId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return new Response(null, { status: 204, headers: corsHeaders });
    return json({ form: data.form_snapshot }, 200, corsHeaders);
  }

  if (request.method === "PUT") {
    const body = await readJson(request);
    requireObject(body.form, "form");

    const { error } = await supabase.from("assessment_drafts").upsert({
      client_instance_id: clientInstanceId,
      form_snapshot: body.form,
      updated_at: new Date().toISOString()
    });

    if (error) throw error;
    return json({ form: body.form }, 200, corsHeaders);
  }

  if (request.method === "DELETE") {
    const { error } = await supabase
      .from("assessment_drafts")
      .delete()
      .eq("client_instance_id", clientInstanceId);

    if (error) throw error;
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return json({ error: "Method not allowed" }, 405, corsHeaders);
}

async function handleRecords(request: Request, clientInstanceId: string, recordId: string | null, corsHeaders: HeadersInit) {
  if (request.method === "GET" && recordId) {
    const { data, error } = await supabase
      .from("assessment_records")
      .select("*")
      .eq("client_instance_id", clientInstanceId)
      .eq("id", recordId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return json({ record: null }, 404, corsHeaders);
    return json({ record: mapRecordRow(data) }, 200, corsHeaders);
  }

  if (request.method === "GET") {
    const { data, error } = await supabase
      .from("assessment_records")
      .select("*")
      .eq("client_instance_id", clientInstanceId)
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) throw error;
    return json({ records: (data || []).map(mapRecordRow) }, 200, corsHeaders);
  }

  if (request.method === "POST" && !recordId) {
    const body = await readJson(request);
    requireObject(body.form, "form");
    requireObject(body.result, "result");
    requireObject(body.record, "record");

    const record = normalizeIncomingRecord(body.record as Partial<AssessmentRecord>, body.form, body.result);
    const { data, error } = await supabase
      .from("assessment_records")
      .insert(toRecordRow(record, clientInstanceId))
      .select("*")
      .single();

    if (error) throw error;

    const verificationTask = createVerificationLog({
      recordId: data.id,
      clientInstanceId,
      form: body.form as Record<string, unknown>,
      result: body.result as Record<string, unknown>
    }).catch((error) => console.error("verification task failed", error));
    runInBackground(verificationTask);

    return json({ record: mapRecordRow(data) }, 201, corsHeaders);
  }

  return json({ error: "Method not allowed" }, 405, corsHeaders);
}

async function createVerificationLog({
  recordId,
  clientInstanceId,
  form,
  result
}: {
  recordId: string;
  clientInstanceId: string;
  form: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  const queryKeywords = Array.isArray(result.queryKeywords)
    ? result.queryKeywords
    : buildVerificationKeywords(String(form.institutionName || ""));
  const institutionName = String(form.institutionName || "").trim();

  if (!institutionName) {
    await insertVerificationLog(recordId, clientInstanceId, queryKeywords, "skipped", [], {}, ["机构名称为空，跳过后台核验"]);
    return;
  }

  if (!ZHIPUAI_API_KEY) {
    await insertVerificationLog(recordId, clientInstanceId, queryKeywords, "pending", [], {}, ["未配置 ZHIPUAI_API_KEY"]);
    return;
  }

  const startedAt = new Date().toISOString();

  try {
    const rawResults = await runZhipuSearch(queryKeywords.slice(0, 5), clientInstanceId);
    const riskTags = extractRiskTags(rawResults);
    const extractedFlags = {
      dishonestyHit: riskTags.some((tag) => tag.includes("失信") || tag.includes("被执行人")),
      majorMedicalPenalty: riskTags.some((tag) => tag.includes("行政处罚") || tag.includes("医美处罚") || tag.includes("非法行医")),
      sourceCount: rawResults.length
    };

    await insertVerificationLog(recordId, clientInstanceId, queryKeywords, "completed", rawResults, extractedFlags, riskTags, startedAt);
  } catch (error) {
    await insertVerificationLog(
      recordId,
      clientInstanceId,
      queryKeywords,
      "failed",
      [],
      {},
      [],
      startedAt,
      error instanceof Error ? error.message : "智谱联网核验失败"
    );
  }
}

async function runZhipuSearch(queryKeywords: unknown[], clientInstanceId: string) {
  const searches = await Promise.all(queryKeywords.map(async (keyword) => {
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/web_search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ZHIPUAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        search_query: String(keyword).slice(0, 70),
        search_engine: "search_std",
        search_intent: false,
        count: 5,
        search_recency_filter: "noLimit",
        content_size: "medium",
        request_id: crypto.randomUUID(),
        user_id: clientInstanceId.slice(0, 128)
      })
    });

    if (!response.ok) {
      throw new Error(`Zhipu search failed with status ${response.status}`);
    }

    const payload = await response.json();
    return {
      keyword,
      results: payload.search_result || []
    };
  }));

  return searches.flatMap((search) => (search.results as unknown[]).map((result) => ({ keyword: search.keyword, result })));
}

async function insertVerificationLog(
  recordId: string,
  clientInstanceId: string,
  queryKeywords: unknown[],
  status: string,
  rawResults: unknown[],
  extractedFlags: Record<string, unknown>,
  riskTags: string[],
  startedAt?: string,
  errorMessage?: string
) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("verification_logs").insert({
    assessment_record_id: recordId,
    client_instance_id: clientInstanceId,
    provider: "zhipu_web_search",
    status,
    query_keywords: queryKeywords,
    raw_results: rawResults,
    extracted_flags: extractedFlags,
    risk_tags: riskTags,
    error_message: errorMessage || null,
    started_at: startedAt || null,
    finished_at: ["completed", "failed", "skipped"].includes(status) ? now : null,
    updated_at: now
  });

  if (error) throw error;
}

function validateRequest(request: Request, origin: string) {
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) {
    throw new Error("Origin is not allowed.");
  }

  const apiKey = request.headers.get("apikey") || "";
  const allowedKeys = new Set([...Object.values(SUPABASE_PUBLISHABLE_KEYS), LEGACY_ANON_KEY].filter(Boolean));
  if (allowedKeys.size && !allowedKeys.has(apiKey)) {
    throw new Error("Invalid apikey header.");
  }
}

function validateClientInstanceId(value: string | null) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9._:-]{6,128}$/.test(id)) {
    throw new Error("Invalid x-client-instance-id header.");
  }
  return id;
}

function parseRoute(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const functionIndex = segments.findIndex((segment) => segment === "assessments");
  const route = functionIndex >= 0 ? segments.slice(functionIndex + 1) : segments;
  return {
    resource: route[0] || "",
    id: route[1] || null
  };
}

function normalizeIncomingRecord(record: Partial<AssessmentRecord>, form: unknown, result: unknown): AssessmentRecord {
  const now = new Date().toISOString();
  return {
    id: String(record.id || crypto.randomUUID()),
    institutionName: String(record.institutionName || "未命名机构"),
    finalGrade: String(record.finalGrade || ""),
    finalDecision: String(record.finalDecision || ""),
    totalScore: Number(record.totalScore || 0),
    maxTermDays: Number(record.maxTermDays || 0),
    suggestedLimit: Number(record.suggestedLimit || 0),
    stableMonthlyAverage: Number(record.stableMonthlyAverage || 0),
    needsApproval: Boolean(record.needsApproval),
    redlineReasons: Array.isArray(record.redlineReasons) ? record.redlineReasons : [],
    capReasons: Array.isArray(record.capReasons) ? record.capReasons : [],
    approvalReasons: Array.isArray(record.approvalReasons) ? record.approvalReasons : [],
    createdAt: record.createdAt || now,
    updatedAt: now,
    form: form as Record<string, unknown>,
    result: result as Record<string, unknown>
  };
}

function toRecordRow(record: AssessmentRecord, clientInstanceId: string) {
  return {
    id: record.id,
    client_instance_id: clientInstanceId,
    institution_name: record.institutionName,
    final_grade: record.finalGrade,
    final_decision: record.finalDecision,
    total_score: record.totalScore,
    max_term_days: record.maxTermDays,
    suggested_limit: record.suggestedLimit,
    stable_monthly_average: record.stableMonthlyAverage,
    needs_approval: record.needsApproval,
    redline_reasons: record.redlineReasons,
    cap_reasons: record.capReasons,
    approval_reasons: record.approvalReasons,
    form_snapshot: record.form,
    result_snapshot: record.result,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function mapRecordRow(row: Record<string, unknown>): AssessmentRecord {
  return {
    id: String(row.id),
    institutionName: String(row.institution_name),
    finalGrade: String(row.final_grade),
    finalDecision: String(row.final_decision),
    totalScore: Number(row.total_score),
    maxTermDays: Number(row.max_term_days),
    suggestedLimit: Number(row.suggested_limit),
    stableMonthlyAverage: Number(row.stable_monthly_average),
    needsApproval: Boolean(row.needs_approval),
    redlineReasons: asStringArray(row.redline_reasons),
    capReasons: asStringArray(row.cap_reasons),
    approvalReasons: asStringArray(row.approval_reasons),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    form: row.form_snapshot as Record<string, unknown>,
    result: row.result_snapshot as Record<string, unknown>
  };
}

function buildVerificationKeywords(institutionName: string) {
  const name = institutionName.trim() || "机构名称";
  return [
    `${name} 行政处罚`,
    `${name} 被执行人`,
    `${name} 失信被执行人`,
    `${name} 医疗美容处罚`,
    `${name} 非法行医`,
    `${name} 经营异常`,
    `${name} 严重违法失信`
  ];
}

function extractRiskTags(rawResults: unknown[]) {
  const text = JSON.stringify(rawResults);
  return [
    ["失信被执行人", /失信被执行人|失信/i],
    ["被执行人", /被执行人/i],
    ["行政处罚", /行政处罚|处罚决定/i],
    ["医美处罚", /医疗美容处罚|医美处罚/i],
    ["非法行医", /非法行医/i],
    ["经营异常", /经营异常/i],
    ["严重违法失信", /严重违法失信/i]
  ]
    .filter(([, pattern]) => (pattern as RegExp).test(text))
    .map(([label]) => String(label));
}

function runInBackground(task: Promise<unknown>) {
  const runtime = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void };
  };

  if (runtime.EdgeRuntime?.waitUntil) {
    runtime.EdgeRuntime.waitUntil(task);
  }
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function requireObject(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function safeJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getCorsHeaders(origin: string): HeadersInit {
  const allowOrigin = ALLOWED_ORIGINS.length ? (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]) : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-instance-id",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Content-Type": "application/json"
  };
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}
