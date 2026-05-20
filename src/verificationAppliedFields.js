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

export function getAssessmentStage({
  activeRecordId,
  isRemoteMode = true,
  summary,
  reviews,
  verificationLogStatus = 'idle',
  verificationReviewStatus = 'idle'
}) {
  const reviewCount = Array.isArray(reviews) ? reviews.length : 0;
  const summaryStatus = summary?.status || '';
  const summaryRiskLevel = summary?.riskLevel || '';
  const hasTerminalVerification = ['completed', 'failed', 'skipped'].includes(summaryStatus);
  const isVerificationLoading = ['loading'].includes(verificationLogStatus) || summaryStatus === 'pending';
  const isReviewSaving = ['saving', 'uploading'].includes(verificationReviewStatus);

  if (!isRemoteMode) {
    return {
      id: 'local',
      tone: 'draft',
      title: '本地预评估',
      statusLabel: '未联网',
      decisionScope: '当前结论仅供内部预估',
      verificationLabel: '本地模式',
      reviewLabel: reviewCount ? `已确认 ${reviewCount} 条` : '未人工确认',
      description: '本地模式不会自动产生联网核验和远端确认日志。',
      actionLabel: '查看结果',
      actionTarget: 'result'
    };
  }

  if (!activeRecordId) {
    return {
      id: 'draft',
      tone: 'draft',
      title: '草稿预评估',
      statusLabel: '未保存',
      decisionScope: '当前结论仅基于已填字段',
      verificationLabel: '未发起核验',
      reviewLabel: '未人工确认',
      description: '保存评估记录后，系统才会进入联网核验和人工确认闭环。',
      actionLabel: '填写基础信息',
      actionTarget: 'basic'
    };
  }

  if (reviewCount > 0) {
    return {
      id: 'final',
      tone: 'final',
      title: '最终评估',
      statusLabel: isReviewSaving ? '确认同步中' : '已人工确认',
      decisionScope: '当前结论已完成复核闭环',
      verificationLabel: hasTerminalVerification ? '已完成核验' : '记录已保存',
      reviewLabel: `已确认 ${reviewCount} 条`,
      description: '人工确认结果已写入风控输入，可作为当前授信建议查看。',
      actionLabel: '查看最终结果',
      actionTarget: 'result'
    };
  }

  if (summaryStatus === 'failed' || verificationLogStatus === 'error') {
    return {
      id: 'verification_failed',
      tone: 'danger',
      title: '核验异常',
      statusLabel: '待重新核验',
      decisionScope: '当前结论仍是预评估',
      verificationLabel: '核验失败',
      reviewLabel: '未人工确认',
      description: '联网核验未形成可确认结果，需刷新或重新核验后再定稿。',
      actionLabel: '查看核验',
      actionTarget: 'verify'
    };
  }

  if (summaryStatus === 'completed' || summaryStatus === 'skipped') {
    return {
      id: 'review_pending',
      tone: summaryRiskLevel === 'high' ? 'danger' : 'review',
      title: '待人工确认',
      statusLabel: summaryStatus === 'skipped' ? '核验已跳过' : '核验已完成',
      decisionScope: '当前结论仍是预评估',
      verificationLabel: summaryStatus === 'skipped' ? '已跳过核验' : '已完成核验',
      reviewLabel: '未人工确认',
      description: '请在核验页采用系统建议或人工改判，保存确认日志后形成最终评估。',
      actionLabel: '确认核验结论',
      actionTarget: 'verify'
    };
  }

  if (isVerificationLoading || verificationLogStatus === 'ready') {
    return {
      id: 'verifying',
      tone: 'verifying',
      title: '联网核验中',
      statusLabel: '等待结果',
      decisionScope: '当前结论仍是预评估',
      verificationLabel: '核验中',
      reviewLabel: '未人工确认',
      description: '后台正在整理公开风险线索，完成后需要人工确认才会定稿。',
      actionLabel: '查看核验进度',
      actionTarget: 'verify'
    };
  }

  return {
    id: 'saved',
    tone: 'draft',
    title: '已保存待核验',
    statusLabel: '等待核验',
    decisionScope: '当前结论仍是预评估',
    verificationLabel: '待核验',
    reviewLabel: '未人工确认',
    description: '评估记录已保存，等待后台生成联网核验结果。',
    actionLabel: '查看核验',
    actionTarget: 'verify'
  };
}
