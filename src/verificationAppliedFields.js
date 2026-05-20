const SERIOUS_STATUS = 'serious';

const getRiskTags = (summary = {}) => (Array.isArray(summary.riskTags) ? summary.riskTags : []);

const getExtractedFlags = (latestLog = {}) => (
  latestLog?.extractedFlags && typeof latestLog.extractedFlags === 'object'
    ? latestLog.extractedFlags
    : {}
);

const hasTag = (riskTags, keywords) => riskTags.some((tag) => keywords.some((keyword) => tag.includes(keyword)));

export function buildVerificationAppliedFields({
  action,
  summary,
  latestLog,
  reviewerDecision,
  currentForm
}) {
  const fields = {};
  if (action === 'mark_reviewed') return fields;

  const riskTags = getRiskTags(summary);
  const extractedFlags = getExtractedFlags(latestLog);
  const currentPublicCreditStatus = currentForm?.publicCreditStatus || 'unknown';

  if (reviewerDecision && reviewerDecision !== currentPublicCreditStatus) {
    fields.publicCreditStatus = reviewerDecision;
  }

  const decisionIsSerious = reviewerDecision === SERIOUS_STATUS;
  const shouldApplyRiskFlags = ['medium', SERIOUS_STATUS].includes(reviewerDecision);

  if (decisionIsSerious && (extractedFlags.dishonestyHit || hasTag(riskTags, ['失信被执行人']))) {
    fields.dishonestyHit = true;
  }

  if (decisionIsSerious && (extractedFlags.seriousIllegalHit || hasTag(riskTags, ['严重违法失信']))) {
    fields.seriousIllegalHit = true;
  }

  if (shouldApplyRiskFlags && (extractedFlags.majorMedicalPenalty || hasTag(riskTags, ['重大医美处罚', '医美处罚', '行政处罚']))) {
    fields.majorMedicalPenalty = true;
  }

  if (shouldApplyRiskFlags && (extractedFlags.outOfScopeOperation || hasTag(riskTags, ['非法行医', '超范围', '生活美容注射']))) {
    fields.outOfScopeOperation = true;
  }

  return Object.fromEntries(
    Object.entries(fields).filter(([field, value]) => currentForm?.[field] !== value)
  );
}

export function getVerificationClosureStatus({ activeRecordId, summary, reviews }) {
  if (!activeRecordId) return '未保存';
  if (!summary) return '待核验';
  if (summary.status === 'pending') return '核验中';
  if (summary.status === 'failed') return '核验失败';
  if (Array.isArray(reviews) && reviews.length > 0) return '已人工确认';
  if (summary.status === 'completed') return '待人工确认';
  return '待核验';
}
