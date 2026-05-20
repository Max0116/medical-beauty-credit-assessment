const REDLINE_TAG_KEYWORDS = [
  '失信被执行人',
  '严重违法失信',
  '非法行医',
  '超范围',
  '生活美容注射',
  '疑似红线'
];

const HIGH_RISK_TAG_KEYWORDS = [
  '行政处罚',
  '医美处罚',
  '医疗美容处罚',
  '经营异常',
  '重大医美处罚',
  '被执行人',
  '中等风险'
];

const getTags = (summary = {}) => (Array.isArray(summary?.riskTags) ? summary.riskTags : []);

const hasTagKeyword = (tags, keywords) => (
  tags.some((tag) => keywords.some((keyword) => String(tag).includes(keyword)))
);

const getMatchedTags = (tags, keywords) => (
  tags.filter((tag) => keywords.some((keyword) => String(tag).includes(keyword)))
);

export function buildDisplayAssessmentResult({
  result,
  assessmentStage,
  latestVerificationSummary,
  verificationReviews = []
}) {
  const hasReview = Array.isArray(verificationReviews) && verificationReviews.length > 0;
  const summaryStatus = latestVerificationSummary?.status || '';
  const tags = getTags(latestVerificationSummary);
  const suggestedStatus = latestVerificationSummary?.suggestedPublicCreditStatus || '';
  const riskLevel = latestVerificationSummary?.riskLevel || '';
  const hasCompletedUnconfirmedVerification = !hasReview && ['completed', 'skipped'].includes(summaryStatus);
  const redlineTags = getMatchedTags(tags, REDLINE_TAG_KEYWORDS);
  const highRiskTags = getMatchedTags(tags, HIGH_RISK_TAG_KEYWORDS);
  const isRedlineSuspected = hasCompletedUnconfirmedVerification
    && (redlineTags.length > 0 || suggestedStatus === 'serious');
  const isHighRiskSuspected = hasCompletedUnconfirmedVerification
    && !isRedlineSuspected
    && (highRiskTags.length > 0 || suggestedStatus === 'medium' || ['medium', 'high'].includes(riskLevel));

  if (!isRedlineSuspected && !isHighRiskSuspected) {
    return {
      result,
      tone: result.finalGrade === 'E'
        ? 'danger'
        : result.needsApproval
          ? 'warning'
          : result.finalGrade === 'C' || result.finalGrade === 'D'
            ? 'caution'
            : 'stable',
      overlay: null
    };
  }

  const overlayTags = isRedlineSuspected
    ? (redlineTags.length ? redlineTags : ['疑似红线'])
    : (highRiskTags.length ? highRiskTags : ['疑似高风险']);
  const overlayReason = isRedlineSuspected
    ? '联网核验发现疑似红线线索，预警覆盖为暂停授信，需人工确认后形成最终结论'
    : '联网核验发现需复核风险线索，预警覆盖为谨慎短账期，需人工确认后形成最终结论';
  const finalGrade = isRedlineSuspected ? 'E' : 'D';
  const finalDecision = isRedlineSuspected ? '疑似红线，暂停授信' : '疑似高风险，待复核';

  return {
    result: {
      ...result,
      finalDecision,
      finalGrade,
      totalScore: isRedlineSuspected ? 0 : Math.min(result.totalScore, 59),
      maxTermDays: isRedlineSuspected ? 0 : Math.min(result.maxTermDays, 7),
      suggestedLimit: isRedlineSuspected ? 0 : Math.min(result.suggestedLimit, Math.round(result.stableMonthlyAverage * 0.2)),
      creditLimitCap: isRedlineSuspected ? 0 : result.creditLimitCap,
      needsApproval: true,
      extraRiskReasons: [
        ...(result.extraRiskReasons || []),
        '预警覆盖，未人工确认',
        overlayReason
      ],
      approvalReasons: [
        ...(result.approvalReasons || []),
        '联网风险线索待人工确认'
      ]
    },
    tone: isRedlineSuspected ? 'danger' : 'warning',
    overlay: {
      level: isRedlineSuspected ? 'redline' : 'highRisk',
      title: finalDecision,
      statusLabel: '预警覆盖，未人工确认',
      reason: overlayReason,
      tags: overlayTags
    }
  };
}
