import type { OfficialRegistryResult } from "./officialRegistry.ts";

export type VerificationEvidence = {
  category: string;
  title: string;
  source: string;
  sourceHost: string;
  publishDate: string;
  url: string;
  snippet: string;
  riskSignal: string;
};

export type RawVerificationResultItem = {
  keyword: string;
  title: string;
  source: string;
  sourceHost: string;
  publishDate: string;
  url: string;
  snippet: string;
  riskTags: string[];
  isRelevant: boolean;
  relevanceStatus: string;
  relevanceReason: string;
};

export type KeywordDiagnostic = {
  keyword: string;
  resultCount: number;
  evidenceCount?: number;
  failed?: boolean;
  errorMessage?: string;
};

export type EvidenceInsight = {
  overview: string;
  keyFindings: string[];
  riskQuestions: string[];
  verificationFocus: string[];
  sourceConfidence: string;
};

export type VerificationProgress = {
  phase?: string;
  completedKeywords?: number;
  totalKeywords?: number;
  partial?: boolean;
  durationMs?: number;
  keywordDiagnostics?: KeywordDiagnostic[];
};

type BusinessProfileCandidate = {
  value: string;
  source: string;
  title: string;
  url: string;
  name?: string;
  registrationStatus?: string;
  legalRepresentative?: string;
  registeredAddress?: string;
  businessScope?: string;
};

type BusinessProfile = {
  registryProvider: string;
  registryStatus: string;
  registryMessage: string;
  creditCodeCandidates: BusinessProfileCandidate[];
};

export function extractVerificationEvidence(institutionName: string, rawResults: unknown[]): VerificationEvidence[] {
  const seen = new Set<string>();

  return rawResults
    .map((item) => normalizeSearchResult(item))
    .filter((item) => item && isInstitutionMatch(institutionName, `${item.title} ${item.content}`))
    .flatMap((item) => {
      const categories = detectRiskCategories(`${item.title} ${item.content}`);
      return categories.map((category) => ({
        category,
        title: item.title,
        source: item.media,
        sourceHost: getHostName(item.link),
        publishDate: item.publishDate,
        url: item.link,
        snippet: item.content.slice(0, 260),
        riskSignal: buildRiskSignal(category, `${item.title} ${item.content}`)
      }));
    })
    .filter((item) => {
      const key = `${item.category}:${item.url || item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function normalizeSearchResult(item: unknown) {
  const wrapper = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const result = wrapper.result && typeof wrapper.result === "object" ? wrapper.result as Record<string, unknown> : {};
  const keyword = String(wrapper.keyword || "").trim();
  const title = String(result.title || "").trim();
  const content = stripHtml(String(result.content || "")).trim();

  if (!title && !content) return null;

  return {
    keyword,
    title,
    content,
    media: String(result.media || "").trim() || "未知来源",
    link: String(result.link || "").trim(),
    publishDate: String(result.publish_date || "").trim()
  };
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function getHostName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function buildRiskSignal(category: string, text: string) {
  const normalized = stripHtml(text);
  const keywordGroups = {
    "失信被执行人": ["失信被执行人", "列入失信", "纳入失信"],
    "严重违法失信": ["严重违法失信", "严重违法"],
    "被执行人": ["被执行人", "执行标的", "执行法院", "执行案件"],
    "行政处罚": ["行政处罚", "处罚决定", "罚款", "警告", "没收违法所得"],
    "医美处罚": ["医疗美容处罚", "医美处罚", "医疗广告违法", "医疗机构校验", "诊疗活动违法"],
    "非法行医": ["非法行医", "未取得医疗机构执业许可证", "无证行医", "超范围开展诊疗"],
    "经营异常": ["经营异常", "列入经营异常", "移出经营异常"]
  } as Record<string, string[]>;
  const matched = (keywordGroups[category] || []).find((keyword) => normalized.includes(keyword));
  return matched ? `原文命中“${matched}”相关表述` : `原文出现“${category}”相关风险语义`;
}

function isInstitutionMatch(institutionName: string, text: string) {
  const normalizedName = normalizeText(institutionName);
  const normalizedText = normalizeText(text);
  if (!normalizedName || !normalizedText) return false;
  if (normalizedText.includes(normalizedName)) return true;

  const coreName = normalizedName
    .replace(/(有限责任公司|股份有限公司|有限公司|医疗美容门诊部|医疗美容诊所|医疗美容医院|门诊部|诊所|医院)$/g, "");
  return coreName.length >= 4 && normalizedText.includes(coreName);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").replace(/[（）()【】[\]·・,，.。:：;；"'“”‘’]/g, "").toLowerCase();
}

function detectRiskCategories(text: string) {
  return [
    ["失信被执行人", /失信被执行人|列入失信|纳入失信/i],
    ["严重违法失信", /严重违法失信|严重违法/i],
    ["被执行人", /被执行人|执行标的|执行法院|执行案件/i],
    ["行政处罚", /行政处罚|处罚决定|罚款|警告|没收违法所得/i],
    ["医美处罚", /医疗美容处罚|医美处罚|医疗广告违法|医疗机构校验|诊疗活动违法/i],
    ["非法行医", /非法行医|未取得医疗机构执业许可证|无证行医|超范围开展诊疗/i],
    ["经营异常", /经营异常|列入经营异常|移出经营异常/i]
  ]
    .filter(([, pattern]) => (pattern as RegExp).test(text))
    .map(([label]) => String(label));
}

export function buildRawResultItems(institutionName: string, rawResults: unknown[]): RawVerificationResultItem[] {
  return rawResults
    .map((item) => normalizeSearchResult(item))
    .filter(Boolean)
    .map((item) => {
      const text = `${item!.title} ${item!.content}`;
      const riskTags = detectRiskCategories(text);
      const institutionMatched = isInstitutionMatch(institutionName, text);
      const isRelevant = institutionMatched && riskTags.length > 0;
      const relevance = getRawResultRelevance({ institutionMatched, riskTags });

      return {
        keyword: item!.keyword,
        title: item!.title,
        source: item!.media,
        sourceHost: getHostName(item!.link),
        publishDate: item!.publishDate,
        url: item!.link,
        snippet: item!.content.slice(0, 260),
        riskTags,
        isRelevant,
        relevanceStatus: relevance.status,
        relevanceReason: relevance.reason
      };
    });
}

function getRawResultRelevance({
  institutionMatched,
  riskTags
}: {
  institutionMatched: boolean;
  riskTags: string[];
}) {
  if (institutionMatched && riskTags.length > 0) {
    return {
      status: "relevant",
      reason: `机构名称与风险关键词同时命中，需人工打开原文确认主体一致性。`
    };
  }
  if (!institutionMatched && riskTags.length > 0) {
    return {
      status: "risk_without_subject",
      reason: `结果包含风险词，但未确认指向本机构，暂不作为匹配证据。`
    };
  }
  if (institutionMatched) {
    return {
      status: "subject_without_risk",
      reason: `机构名称匹配，但正文未命中风险关键词，暂不形成风险证据。`
    };
  }
  return {
    status: "unrelated",
    reason: `未确认指向本机构，暂不作为风险证据。`
  };
}

function buildKeywordDiagnostics(
  rawResults: unknown[],
  rawResultItems: RawVerificationResultItem[],
  suppliedDiagnostics: KeywordDiagnostic[] = []
) {
  const diagnostics = new Map<string, KeywordDiagnostic>();

  for (const item of suppliedDiagnostics) {
    if (!item.keyword) continue;
    diagnostics.set(item.keyword, {
      keyword: item.keyword,
      resultCount: Number(item.resultCount || 0),
      evidenceCount: Number(item.evidenceCount || 0),
      failed: Boolean(item.failed),
      errorMessage: item.errorMessage || ""
    });
  }

  for (const raw of rawResults) {
    const normalized = normalizeSearchResult(raw);
    const keyword = normalized?.keyword || "未标记关键词";
    const current = diagnostics.get(keyword) || { keyword, resultCount: 0, evidenceCount: 0 };
    current.resultCount = Number(current.resultCount || 0) + 1;
    diagnostics.set(keyword, current);
  }

  for (const item of rawResultItems) {
    if (!item.isRelevant) continue;
    const keyword = item.keyword || "未标记关键词";
    const current = diagnostics.get(keyword) || { keyword, resultCount: 0, evidenceCount: 0 };
    current.evidenceCount = Number(current.evidenceCount || 0) + 1;
    diagnostics.set(keyword, current);
  }

  return [...diagnostics.values()];
}

export function buildVerificationSummary({
  status,
  institutionName,
  rawResults,
  riskTags,
  evidence,
  officialRegistry,
  evidenceInsight,
  errorMessage = "",
  progress = {}
}: {
  status: string;
  institutionName: string;
  rawResults: unknown[];
  riskTags: string[];
  evidence: VerificationEvidence[];
  officialRegistry?: OfficialRegistryResult;
  evidenceInsight?: EvidenceInsight;
  errorMessage?: string;
  progress?: VerificationProgress;
}) {
  const sourceCount = rawResults.length;
  const evidenceCount = evidence.length;
  const judgment = getVerificationJudgment(status, riskTags, evidenceCount);
  const businessProfile = buildBusinessProfile(officialRegistry);
  const rawResultItems = buildRawResultItems(institutionName, rawResults);
  const keywordDiagnostics = buildKeywordDiagnostics(rawResults, rawResultItems, progress.keywordDiagnostics);
  const insight = evidenceInsight
    || buildFallbackEvidenceInsight(institutionName, riskTags, evidence, {
      status,
      sourceCount,
      rawResultItems
    });

  return {
    dishonestyHit: riskTags.includes("失信被执行人"),
    seriousIllegalHit: riskTags.includes("严重违法失信"),
    executorHit: riskTags.includes("被执行人"),
    majorMedicalPenalty: riskTags.some((tag) => ["行政处罚", "医美处罚", "非法行医"].includes(tag)),
    businessAbnormalHit: riskTags.includes("经营异常"),
    sourceCount,
    matchedSourceCount: evidenceCount,
    verificationSummary: {
      institutionName,
      status,
      judgment,
      judgmentLabel: getJudgmentLabel(judgment),
      riskLevel: getRiskLevel(judgment),
      conclusion: getVerificationConclusion(judgment, evidenceCount, riskTags, errorMessage),
      recommendation: getVerificationRecommendation(judgment),
      suggestedPublicCreditStatus: getSuggestedPublicCreditStatus(judgment),
      sourceCount,
      matchedSourceCount: evidenceCount,
      phase: progress.phase || status,
      completedKeywords: progress.completedKeywords ?? null,
      totalKeywords: progress.totalKeywords ?? null,
      partial: Boolean(progress.partial),
      durationMs: progress.durationMs ?? null,
      businessProfile,
      riskTags,
      keywordDiagnostics,
      rawResultItems: rawResultItems.slice(0, 40),
      evidenceInsight: insight,
      evidenceSummaries: evidence,
      generatedAt: new Date().toISOString(),
      errorMessage
    }
  };
}

export function buildFallbackEvidenceInsight(
  institutionName: string,
  riskTags: string[],
  evidence: VerificationEvidence[],
  context: {
    status?: string;
    sourceCount?: number;
    rawResultItems?: RawVerificationResultItem[];
  } = {}
): EvidenceInsight {
  const uniqueTags = [...new Set(riskTags)];
  const sourceNames = [...new Set(evidence.map((item) => item.sourceHost || item.source).filter(Boolean))].slice(0, 3);
  const topEvidence = evidence.slice(0, 3);
  const sourceCount = context.sourceCount ?? evidence.length;
  const hasCompletedClearSearch = context.status === "completed" && !evidence.length;
  const isWaitingForSearch = ["pending", "running"].includes(String(context.status || ""));
  const isFailedSearch = context.status === "failed";

  return {
    overview: hasCompletedClearSearch
      ? `已查询 ${sourceCount} 条公开搜索结果，但未形成风险证据；建议业务保留查询记录，并抽查原文确认是否存在同名机构干扰。`
      : isWaitingForSearch
        ? `公共风险核验正在进行中，系统会先返回原始搜索结果，再整理风险线索和 AI 摘要。`
        : isFailedSearch
          ? `本次联网核验失败，未形成可采信风险证据；建议稍后重新核验。`
      : uniqueTags.length
      ? `已发现与“${institutionName || "该机构"}”名称匹配的公共风险线索，主要集中在${uniqueTags.join("、")}。以下内容仅为联网公开信息线索，需人工点开原文复核。`
      : `已完成联网核验，当前未形成明确风险分类；建议保留来源记录并人工抽查关键页面。`,
    keyFindings: topEvidence.length
      ? topEvidence.map((item) => `${item.category}：${item.title || item.snippet || "待核验来源"}`).slice(0, 4)
      : [`已查询但未形成风险证据，原始结果仍需留痕备查。`],
    riskQuestions: uniqueTags.length
      ? uniqueTags.slice(0, 4).map((tag) => `原文中的“${tag}”是否确认指向本机构主体、同一信用代码或同一经营地址？`)
      : ["搜索结果是否存在同名机构、旧名称或分支机构混淆？"],
    verificationFocus: [
      "逐条打开原始报道或公示页面，确认主体名称、时间、处罚/执行状态。",
      "核对统一社会信用代码、注册地址、诊疗许可主体是否一致。",
      "将可采信页面链接或截图写入人工确认日志。"
    ],
    sourceConfidence: hasCompletedClearSearch
      ? `已返回 ${sourceCount} 条原始搜索结果，系统未识别出可采信风险证据；仍需人工抽查原文。`
      : sourceNames.length
      ? `已提取 ${evidence.length} 条线索，来源包含 ${sourceNames.join("、")}；仍需人工复核原文。`
      : `已提取 ${evidence.length} 条线索，但来源可信度需人工判断。`
  };
}

export function buildBusinessProfile(officialRegistry?: OfficialRegistryResult): BusinessProfile {
  return {
    registryProvider: officialRegistry?.provider || "official_registry",
    registryStatus: officialRegistry?.status || "unconfigured",
    registryMessage: officialRegistry?.message || "未配置官方企业信用接口",
    creditCodeCandidates: (officialRegistry?.candidates || [])
      .filter((item) => item.creditCode)
      .map((item) => ({
        value: item.creditCode,
        source: item.source || officialRegistry?.provider || "official_registry",
        title: item.name,
        url: item.sourceUrl,
        name: item.name,
        registrationStatus: item.registrationStatus,
        legalRepresentative: item.legalRepresentative,
        registeredAddress: item.registeredAddress,
        businessScope: item.businessScope
      }))
  };
}

function getVerificationJudgment(status: string, riskTags: string[], evidenceCount: number) {
  if (status === "pending") return "pending";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  if (status === "running" && !evidenceCount) return "pending";
  if (!evidenceCount) return "clear";
  if (riskTags.some((tag) => ["失信被执行人", "严重违法失信", "非法行医", "医美处罚"].includes(tag))) {
    return "redline_suspected";
  }
  if (riskTags.some((tag) => ["被执行人", "行政处罚", "经营异常"].includes(tag))) {
    return "review_required";
  }
  return "clear";
}

function getJudgmentLabel(judgment: string) {
  return ({
    pending: "等待联网核验",
    failed: "核验失败",
    skipped: "已跳过核验",
    clear: "未发现明显风险",
    review_required: "需人工复核",
    redline_suspected: "疑似红线风险"
  } as Record<string, string>)[judgment] || "需人工复核";
}

function getRiskLevel(judgment: string) {
  return ({
    clear: "low",
    pending: "unknown",
    skipped: "unknown",
    failed: "unknown",
    review_required: "medium",
    redline_suspected: "high"
  } as Record<string, string>)[judgment] || "medium";
}

function getVerificationConclusion(judgment: string, evidenceCount: number, riskTags: string[], errorMessage: string) {
  if (judgment === "pending") return "已提交后台查询，等待智谱联网核验结果。";
  if (judgment === "failed") return `联网核验失败：${errorMessage || "请稍后重试或人工查询"}`;
  if (judgment === "skipped") return "机构名称为空，未发起联网核验。";
  if (judgment === "clear") return "已查询公开搜索结果，但未形成风险证据；建议保留记录并人工抽查原文。";
  if (judgment === "redline_suspected") {
    return `发现 ${evidenceCount} 条与机构名称匹配的高风险线索：${riskTags.join("、")}。`;
  }
  return `发现 ${evidenceCount} 条与机构名称匹配的需复核线索：${riskTags.join("、")}。`;
}

function getVerificationRecommendation(judgment: string) {
  return ({
    pending: "等待核验完成后再提交审批。",
    failed: "请重试联网核验，或保留人工查询截图后再审批。",
    skipped: "请先填写机构名称。",
    clear: "可将公共信用状态暂按“正常”处理，但仍建议保留人工抽查记录。",
    review_required: "建议将公共信用状态调整为“中等风险”或补充人工核验证据。",
    redline_suspected: "建议暂缓授信，人工核验原始来源；确认后按红线或重大处罚处理。"
  } as Record<string, string>)[judgment] || "请人工复核。";
}

function getSuggestedPublicCreditStatus(judgment: string) {
  return ({
    clear: "normal",
    review_required: "medium",
    redline_suspected: "serious",
    pending: "unknown",
    failed: "unknown",
    skipped: "unknown"
  } as Record<string, string>)[judgment] || "unknown";
}
