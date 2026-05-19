export type VerificationEvidence = {
  category: string;
  title: string;
  source: string;
  publishDate: string;
  url: string;
  snippet: string;
};

type BusinessProfileCandidate = {
  value: string;
  source: string;
  title: string;
  url: string;
};

type BusinessProfile = {
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
        publishDate: item.publishDate,
        url: item.link,
        snippet: item.content.slice(0, 160)
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
  const title = String(result.title || "").trim();
  const content = stripHtml(String(result.content || "")).trim();

  if (!title && !content) return null;

  return {
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

export function buildVerificationSummary({
  status,
  institutionName,
  rawResults,
  riskTags,
  evidence,
  errorMessage = ""
}: {
  status: string;
  institutionName: string;
  rawResults: unknown[];
  riskTags: string[];
  evidence: VerificationEvidence[];
  errorMessage?: string;
}) {
  const sourceCount = rawResults.length;
  const evidenceCount = evidence.length;
  const judgment = getVerificationJudgment(status, riskTags, evidenceCount);
  const businessProfile = extractBusinessProfile(institutionName, rawResults);

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
      businessProfile,
      riskTags,
      evidenceSummaries: evidence,
      generatedAt: new Date().toISOString(),
      errorMessage
    }
  };
}

export function extractBusinessProfile(institutionName: string, rawResults: unknown[]): BusinessProfile {
  const seenCodes = new Set<string>();
  const creditCodeCandidates = rawResults
    .map((item) => normalizeSearchResult(item))
    .filter((item) => item && isInstitutionMatch(institutionName, `${item.title} ${item.content}`))
    .flatMap((item) => {
      const matches = `${item.title} ${item.content}`.match(/[0-9A-Z]{18}/gi) || [];
      return matches.map((value) => ({
        value: value.toUpperCase(),
        source: item.media,
        title: item.title,
        url: item.link
      }));
    })
    .filter((item) => {
      if (seenCodes.has(item.value)) return false;
      seenCodes.add(item.value);
      return true;
    })
    .slice(0, 3);

  return { creditCodeCandidates };
}

function getVerificationJudgment(status: string, riskTags: string[], evidenceCount: number) {
  if (status === "pending") return "pending";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
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
  if (judgment === "clear") return "已完成联网查询，未发现与该机构名称直接匹配的明显负面风险结果。";
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
