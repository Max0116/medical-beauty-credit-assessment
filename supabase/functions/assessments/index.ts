import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createOfficialRegistryConfig, queryOfficialRegistry } from "./officialRegistry.ts";
import {
  buildFallbackEvidenceInsight,
  buildVerificationSummary,
  extractVerificationEvidence,
  type EvidenceInsight,
  type VerificationEvidence
} from "./verificationEvidence.ts";

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

type VerificationReview = {
  id?: string;
  recordId: string;
  verificationLogId: string | null;
  action: string;
  reviewerName: string;
  reviewerDecision: string;
  previousPublicCreditStatus: string;
  suggestedPublicCreditStatus: string;
  evidenceUrl: string;
  evidenceNote: string;
  evidenceAttachments: EvidenceAttachment[];
  verificationSnapshot: Record<string, unknown>;
  appliedFields: Record<string, unknown>;
  createdAt?: string;
};

type EvidenceAttachment = {
  id: string;
  bucket: string;
  path: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  signedUrl?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ASSESSMENT_SECRET_KEYS = safeJson<Record<string, string>>(Deno.env.get("ASSESSMENT_SECRET_KEYS"), {});
const ASSESSMENT_PUBLISHABLE_KEYS = safeJson<Record<string, string>>(Deno.env.get("ASSESSMENT_PUBLISHABLE_KEYS"), {});
const ASSESSMENT_SERVICE_ROLE_KEY = Deno.env.get("ASSESSMENT_SERVICE_ROLE_KEY") || ASSESSMENT_SECRET_KEYS.default || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ASSESSMENT_SERVICE_ROLE_KEY;
const LEGACY_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const ZHIPUAI_API_KEY = Deno.env.get("ZHIPUAI_API_KEY") || "";
const ZHIPUAI_SUMMARY_MODEL = Deno.env.get("ZHIPUAI_SUMMARY_MODEL") || "glm-4-flash";
const EVIDENCE_BUCKET = "verification-evidence";
const EVIDENCE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const EVIDENCE_ATTACHMENT_SIGNED_URL_SECONDS = 60 * 60 * 24 * 7;
const EVIDENCE_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf"
]);
const OFFICIAL_REGISTRY_CONFIG = createOfficialRegistryConfig({
  endpoint: Deno.env.get("OFFICIAL_REGISTRY_API_URL") || "",
  apiKey: Deno.env.get("OFFICIAL_REGISTRY_API_KEY") || "",
  provider: Deno.env.get("OFFICIAL_REGISTRY_PROVIDER") || "",
  authHeaderName: Deno.env.get("OFFICIAL_REGISTRY_AUTH_HEADER_NAME") || "",
  authHeaderPrefix: Deno.env.get("OFFICIAL_REGISTRY_AUTH_HEADER_PREFIX") || ""
});
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
    const { resource, id, action } = parseRoute(new URL(request.url));

    if (resource === "draft") {
      return await handleDraft(request, clientInstanceId, corsHeaders);
    }

    if (resource === "records") {
      return await handleRecords(request, clientInstanceId, id, corsHeaders, action);
    }

    return json({ error: "Not found" }, 404, corsHeaders);
  } catch (error) {
    console.error("assessment function failed", error);
    return json({ error: formatErrorMessage(error) }, 400, corsHeaders);
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

async function handleRecords(
  request: Request,
  clientInstanceId: string,
  recordId: string | null,
  corsHeaders: HeadersInit,
  action: string | null
) {
  if (recordId && action === "verification") {
    return await handleVerificationLogs(request, clientInstanceId, recordId, corsHeaders);
  }

  if (recordId && action === "verification-reviews") {
    return await handleVerificationReviews(request, clientInstanceId, recordId, corsHeaders);
  }

  if (recordId && action === "verification-attachments") {
    return await handleVerificationAttachmentUpload(request, clientInstanceId, recordId, corsHeaders);
  }

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

  if (request.method === "PUT" && recordId) {
    const body = await readJson(request);
    requireObject(body.form, "form");
    requireObject(body.result, "result");
    requireObject(body.record, "record");

    const record = normalizeIncomingRecord(body.record as Partial<AssessmentRecord>, body.form, body.result);
    const { data, error } = await supabase
      .from("assessment_records")
      .update(toRecordRow({ ...record, id: recordId }, clientInstanceId))
      .eq("client_instance_id", clientInstanceId)
      .eq("id", recordId)
      .select("*")
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

async function handleVerificationLogs(
  request: Request,
  clientInstanceId: string,
  recordId: string,
  corsHeaders: HeadersInit
) {
  if (request.method === "GET") {
    const { data, error } = await supabase
      .from("verification_logs")
      .select("*")
      .eq("client_instance_id", clientInstanceId)
      .eq("assessment_record_id", recordId)
      .order("created_at", { ascending: false })
      .limit(6);

    if (error) throw error;
    return json({ verificationLogs: (data || []).map(mapVerificationLogRow) }, 200, corsHeaders);
  }

  if (request.method === "POST") {
    const { data: record, error } = await supabase
      .from("assessment_records")
      .select("id, form_snapshot, result_snapshot")
      .eq("client_instance_id", clientInstanceId)
      .eq("id", recordId)
      .maybeSingle();

    if (error) throw error;
    if (!record) return json({ error: "Assessment record not found." }, 404, corsHeaders);

    const form = asObject(record.form_snapshot);
    const result = asObject(record.result_snapshot);
    const institutionName = String(form.institutionName || "").trim();
    const queryKeywords = Array.isArray(result.queryKeywords)
      ? result.queryKeywords
      : buildVerificationKeywords(institutionName);
    const startedAt = new Date().toISOString();
    const pendingRow = await insertVerificationLog(
      recordId,
      clientInstanceId,
      queryKeywords,
      "pending",
      [],
      buildVerificationSummary({ status: "pending", institutionName, rawResults: [], riskTags: [], evidence: [] }),
      ["手动重新发起联网核验"],
      startedAt
    );

    const verificationTask = createVerificationLog({
      recordId,
      clientInstanceId,
      form,
      result,
      existingLogId: String(pendingRow.id)
    }).catch((error) => console.error("manual verification rerun failed", error));
    runInBackground(verificationTask);

    return json({ verificationLog: mapVerificationLogRow(pendingRow) }, 202, corsHeaders);
  }

  return json({ error: "Method not allowed" }, 405, corsHeaders);
}

async function handleVerificationReviews(
  request: Request,
  clientInstanceId: string,
  recordId: string,
  corsHeaders: HeadersInit
) {
  if (request.method === "GET") {
    const { data, error } = await supabase
      .from("verification_reviews")
      .select("*")
      .eq("client_instance_id", clientInstanceId)
      .eq("assessment_record_id", recordId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    const reviews = await Promise.all((data || []).map(mapVerificationReviewRow));
    return json({ verificationReviews: reviews }, 200, corsHeaders);
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    const review = normalizeIncomingVerificationReview(body as Record<string, unknown>, recordId, clientInstanceId);

    const { data, error } = await supabase
      .from("verification_reviews")
      .insert(toVerificationReviewRow(review, clientInstanceId))
      .select("*")
      .single();

    if (error) throw error;
    return json({ verificationReview: await mapVerificationReviewRow(data) }, 201, corsHeaders);
  }

  return json({ error: "Method not allowed" }, 405, corsHeaders);
}

async function handleVerificationAttachmentUpload(
  request: Request,
  clientInstanceId: string,
  recordId: string,
  corsHeaders: HeadersInit
) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const { data: record, error: recordError } = await supabase
    .from("assessment_records")
    .select("id")
    .eq("client_instance_id", clientInstanceId)
    .eq("id", recordId)
    .maybeSingle();

  if (recordError) throw recordError;
  if (!record) return json({ error: "Assessment record not found." }, 404, corsHeaders);

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("file is required.");
  }
  if (file.size <= 0) {
    throw new Error("file must not be empty.");
  }
  if (file.size > EVIDENCE_ATTACHMENT_MAX_BYTES) {
    throw new Error("file must be 10MB or smaller.");
  }
  if (!EVIDENCE_ATTACHMENT_MIME_TYPES.has(file.type)) {
    throw new Error("file type is not supported.");
  }

  const attachmentId = crypto.randomUUID();
  const safeName = sanitizeFileName(file.name || "evidence");
  const path = [
    sanitizeStorageSegment(clientInstanceId),
    sanitizeStorageSegment(recordId),
    `${attachmentId}-${safeName}`
  ].join("/");
  const { error: uploadError } = await supabase
    .storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false
    });

  if (uploadError) throw uploadError;

  const attachment = await signEvidenceAttachment({
    id: attachmentId,
    bucket: EVIDENCE_BUCKET,
    path,
    fileName: file.name || safeName,
    mimeType: file.type,
    size: file.size,
    uploadedAt: new Date().toISOString()
  });

  return json({ attachment }, 201, corsHeaders);
}

async function createVerificationLog({
  recordId,
  clientInstanceId,
  form,
  result,
  existingLogId
}: {
  recordId: string;
  clientInstanceId: string;
  form: Record<string, unknown>;
  result: Record<string, unknown>;
  existingLogId?: string;
}) {
  const queryKeywords = Array.isArray(result.queryKeywords)
    ? result.queryKeywords
    : buildVerificationKeywords(String(form.institutionName || ""));
  const institutionName = String(form.institutionName || "").trim();

  if (!institutionName) {
    await insertVerificationLog(
      recordId,
      clientInstanceId,
      queryKeywords,
      "skipped",
      [],
      buildVerificationSummary({ status: "skipped", institutionName, rawResults: [], riskTags: [], evidence: [] }),
      ["机构名称为空，跳过后台核验"],
      undefined,
      undefined,
      existingLogId
    );
    return;
  }

  const startedAt = new Date().toISOString();
  const officialRegistry = await queryOfficialRegistry({
    config: OFFICIAL_REGISTRY_CONFIG,
    institutionName,
    creditCode: String(form.creditCode || ""),
    clientInstanceId
  });

  if (!ZHIPUAI_API_KEY) {
    await insertVerificationLog(
      recordId,
      clientInstanceId,
      queryKeywords,
      "pending",
      [],
      buildVerificationSummary({
        status: "pending",
        institutionName,
        rawResults: [],
        riskTags: [],
        evidence: [],
        officialRegistry
      }),
      ["未配置 ZHIPUAI_API_KEY"],
      undefined,
      undefined,
      existingLogId
    );
    return;
  }

  try {
    const rawResults = await runZhipuSearch(queryKeywords.slice(0, 7), clientInstanceId);
    const evidence = extractVerificationEvidence(institutionName, rawResults);
    const riskTags = [...new Set(evidence.map((item) => item.category))];
    const evidenceInsight = evidence.length
      ? await summarizeEvidenceWithAi({ institutionName, evidence, riskTags, clientInstanceId })
      : undefined;
    const extractedFlags = buildVerificationSummary({
      status: "completed",
      institutionName,
      rawResults,
      riskTags,
      evidence,
      officialRegistry,
      evidenceInsight
    });

    await insertVerificationLog(recordId, clientInstanceId, queryKeywords, "completed", rawResults, extractedFlags, riskTags, startedAt, undefined, existingLogId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "智谱联网核验失败";
    await insertVerificationLog(
      recordId,
      clientInstanceId,
      queryKeywords,
      "failed",
      [],
      buildVerificationSummary({ status: "failed", institutionName, rawResults: [], riskTags: [], evidence: [], officialRegistry, errorMessage: message }),
      [],
      startedAt,
      message,
      existingLogId
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

async function summarizeEvidenceWithAi({
  institutionName,
  evidence,
  riskTags,
  clientInstanceId
}: {
  institutionName: string;
  evidence: VerificationEvidence[];
  riskTags: string[];
  clientInstanceId: string;
}): Promise<EvidenceInsight> {
  try {
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ZHIPUAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: ZHIPUAI_SUMMARY_MODEL,
        messages: [
          {
            role: "system",
            content: [
              "你是医美机构授信核验助手。",
              "只能基于用户提供的联网搜索证据做摘要，不得补充未给出的事实。",
              "不要把线索写成已确认结论，必须提示人工打开原文复核。",
              "只输出 JSON，不要 Markdown。"
            ].join("")
          },
          {
            role: "user",
            content: JSON.stringify({
              institutionName,
              riskTags,
              evidence: evidence.slice(0, 8).map((item) => ({
                category: item.category,
                title: item.title,
                source: item.source,
                sourceHost: item.sourceHost,
                publishDate: item.publishDate,
                url: item.url,
                snippet: item.snippet,
                riskSignal: item.riskSignal
              })),
              outputSchema: {
                overview: "一句话总结线索整体情况，明确这是线索不是结论",
                keyFindings: ["3-5 条关键发现，每条都引用类别或来源"],
                riskQuestions: ["2-4 条人工复核问题"],
                verificationFocus: ["2-4 条下一步核验重点"],
                sourceConfidence: "对来源数量、来源类型、是否需要原文复核的说明"
              }
            })
          }
        ],
        temperature: 0.2,
        user_id: clientInstanceId.slice(0, 128)
      })
    });

    if (!response.ok) {
      throw new Error(`Zhipu summary failed with status ${response.status}`);
    }

    const payload = await response.json();
    const content = String(payload?.choices?.[0]?.message?.content || "");
    return normalizeEvidenceInsight(parseJsonContent(content));
  } catch (error) {
    console.error("evidence summary fallback used", error);
    return buildFallbackEvidenceInsight(institutionName, riskTags, evidence);
  }
}

function parseJsonContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("empty evidence insight response");

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("evidence insight response is not JSON");
    return JSON.parse(match[0]);
  }
}

function normalizeEvidenceInsight(value: unknown): EvidenceInsight {
  const objectValue = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    overview: clipText(String(objectValue.overview || "已提取联网线索，请人工打开原文复核。"), 180),
    keyFindings: normalizeTextList(objectValue.keyFindings, 5),
    riskQuestions: normalizeTextList(objectValue.riskQuestions, 4),
    verificationFocus: normalizeTextList(objectValue.verificationFocus, 4),
    sourceConfidence: clipText(String(objectValue.sourceConfidence || "来源可信度需人工结合原文判断。"), 180)
  };
}

function normalizeTextList(value: unknown, limit: number) {
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((item) => clipText(String(item || "").trim(), 120))
    .filter(Boolean)
    .slice(0, limit);
}

function clipText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
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
  errorMessage?: string,
  logId?: string
) {
  const now = new Date().toISOString();
  const payload = {
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
  };

  const query = logId
    ? supabase
      .from("verification_logs")
      .update(payload)
      .eq("id", logId)
      .eq("client_instance_id", clientInstanceId)
      .eq("assessment_record_id", recordId)
      .select("*")
      .single()
    : supabase
      .from("verification_logs")
      .insert(payload)
      .select("*")
      .single();

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function validateRequest(request: Request, origin: string) {
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) {
    throw new Error("Origin is not allowed.");
  }

  const apiKey = request.headers.get("apikey") || "";
  const allowedKeys = new Set([...Object.values(ASSESSMENT_PUBLISHABLE_KEYS), LEGACY_ANON_KEY].filter(Boolean));
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
    id: route[1] || null,
    action: route[2] || null
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

function mapVerificationLogRow(row: Record<string, unknown>) {
  const extractedFlags = row.extracted_flags && typeof row.extracted_flags === "object"
    ? row.extracted_flags as Record<string, unknown>
    : {};

  return {
    id: String(row.id),
    recordId: String(row.assessment_record_id || ""),
    provider: String(row.provider || ""),
    status: String(row.status || ""),
    queryKeywords: Array.isArray(row.query_keywords) ? row.query_keywords.map(String) : [],
    riskTags: asStringArray(row.risk_tags),
    extractedFlags,
    verificationSummary: extractedFlags.verificationSummary || null,
    rawResultCount: Array.isArray(row.raw_results) ? row.raw_results.length : 0,
    errorMessage: row.error_message ? String(row.error_message) : "",
    startedAt: row.started_at ? String(row.started_at) : "",
    finishedAt: row.finished_at ? String(row.finished_at) : "",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function normalizeIncomingVerificationReview(body: Record<string, unknown>, recordId: string, clientInstanceId: string): VerificationReview {
  const action = String(body.action || "").trim();
  const reviewerName = String(body.reviewerName || "").trim();
  const reviewerDecision = String(body.reviewerDecision || "").trim();
  const verificationLogId = String(body.verificationLogId || "").trim();
  const previousPublicCreditStatus = String(body.previousPublicCreditStatus || "").trim();
  const suggestedPublicCreditStatus = String(body.suggestedPublicCreditStatus || "").trim();
  const evidenceUrl = String(body.evidenceUrl || "").trim();
  const evidenceNote = String(body.evidenceNote || "").trim();
  const evidenceAttachments = normalizeEvidenceAttachments(body.evidenceAttachments, clientInstanceId, recordId);
  const verificationSnapshot = body.verificationSnapshot && typeof body.verificationSnapshot === "object" && !Array.isArray(body.verificationSnapshot)
    ? body.verificationSnapshot as Record<string, unknown>
    : {};
  const appliedFields = body.appliedFields && typeof body.appliedFields === "object" && !Array.isArray(body.appliedFields)
    ? body.appliedFields as Record<string, unknown>
    : {};

  if (!["accept_suggestion", "manual_override", "mark_reviewed"].includes(action)) {
    throw new Error("Invalid verification review action.");
  }
  if (!reviewerName) {
    throw new Error("reviewerName is required.");
  }
  if (!["normal", "unknown", "medium", "serious"].includes(reviewerDecision)) {
    throw new Error("Invalid reviewerDecision.");
  }
  if (verificationLogId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(verificationLogId)) {
    throw new Error("Invalid verificationLogId.");
  }

  return {
    recordId,
    verificationLogId: verificationLogId || null,
    action,
    reviewerName,
    reviewerDecision,
    previousPublicCreditStatus,
    suggestedPublicCreditStatus,
    evidenceUrl,
    evidenceNote,
    evidenceAttachments,
    verificationSnapshot,
    appliedFields
  };
}

function toVerificationReviewRow(review: VerificationReview, clientInstanceId: string) {
  const verificationSnapshot = {
    ...review.verificationSnapshot,
    evidenceAttachments: review.evidenceAttachments
  };

  return {
    assessment_record_id: review.recordId,
    verification_log_id: review.verificationLogId,
    client_instance_id: clientInstanceId,
    action: review.action,
    reviewer_name: review.reviewerName,
    reviewer_decision: review.reviewerDecision,
    previous_public_credit_status: review.previousPublicCreditStatus || null,
    suggested_public_credit_status: review.suggestedPublicCreditStatus || null,
    evidence_url: review.evidenceUrl || null,
    evidence_note: review.evidenceNote || null,
    verification_snapshot: verificationSnapshot,
    applied_fields: review.appliedFields
  };
}

async function mapVerificationReviewRow(row: Record<string, unknown>) {
  const verificationSnapshot = row.verification_snapshot && typeof row.verification_snapshot === "object"
    ? row.verification_snapshot as Record<string, unknown>
    : {};
  const evidenceAttachments = row.evidence_attachments ?? verificationSnapshot.evidenceAttachments;

  return {
    id: String(row.id),
    recordId: String(row.assessment_record_id || ""),
    verificationLogId: row.verification_log_id ? String(row.verification_log_id) : "",
    action: String(row.action || ""),
    reviewerName: String(row.reviewer_name || ""),
    reviewerDecision: String(row.reviewer_decision || ""),
    previousPublicCreditStatus: String(row.previous_public_credit_status || ""),
    suggestedPublicCreditStatus: String(row.suggested_public_credit_status || ""),
    evidenceUrl: String(row.evidence_url || ""),
    evidenceNote: String(row.evidence_note || ""),
    evidenceAttachments: await signEvidenceAttachments(evidenceAttachments),
    verificationSnapshot,
    appliedFields: row.applied_fields && typeof row.applied_fields === "object"
      ? row.applied_fields
      : {},
    createdAt: String(row.created_at)
  };
}

function normalizeEvidenceAttachments(value: unknown, clientInstanceId: unknown, recordId: string): EvidenceAttachment[] {
  if (!Array.isArray(value)) return [];
  const prefix = `${sanitizeStorageSegment(String(clientInstanceId || ""))}/${sanitizeStorageSegment(recordId)}/`;

  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({
      id: String(item.id || "").trim(),
      bucket: String(item.bucket || "").trim(),
      path: String(item.path || "").trim(),
      fileName: String(item.fileName || "").trim(),
      mimeType: String(item.mimeType || "").trim(),
      size: Number(item.size || 0),
      uploadedAt: String(item.uploadedAt || "").trim()
    }))
    .filter((item) => item.bucket === EVIDENCE_BUCKET && item.path.startsWith(prefix) && item.fileName)
    .slice(0, 6);
}

async function signEvidenceAttachments(value: unknown): Promise<EvidenceAttachment[]> {
  if (!Array.isArray(value)) return [];
  const attachments = value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => item as EvidenceAttachment)
    .filter((item) => item.bucket === EVIDENCE_BUCKET && item.path);

  return await Promise.all(attachments.map(signEvidenceAttachment));
}

async function signEvidenceAttachment(attachment: EvidenceAttachment): Promise<EvidenceAttachment> {
  const { data, error } = await supabase
    .storage
    .from(attachment.bucket)
    .createSignedUrl(attachment.path, EVIDENCE_ATTACHMENT_SIGNED_URL_SECONDS);

  return {
    ...attachment,
    signedUrl: error ? "" : data?.signedUrl || ""
  };
}

function sanitizeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 120) || "evidence";
}

function sanitizeStorageSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 128) || "unknown";
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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Unknown error");
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
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
