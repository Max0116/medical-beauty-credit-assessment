const TERMINAL_VERIFICATION_STATUSES = ['completed', 'failed', 'skipped'];

const isFilled = (value) => String(value || '').trim().length > 0;

export function getVerificationProgress({ activeRecordId, status, summary }) {
  if (!activeRecordId) return 0;
  if (summary?.completedKeywords && summary?.totalKeywords) {
    const ratio = Math.min(Number(summary.completedKeywords) / Number(summary.totalKeywords), 1);
    return Math.max(12, Math.round(ratio * 88));
  }
  if (summary?.status === 'completed') return 100;
  if (summary?.status === 'failed' || summary?.status === 'skipped') return 100;
  if (summary?.phase === 'summarizing') return 92;
  if (summary?.phase === 'searching_full') return 76;
  if (summary?.phase === 'searching_fast') return 48;
  if (summary?.status === 'running') return 60;
  if (summary?.status === 'pending') return 26;
  if (status === 'loading') return 42;
  if (status === 'ready') return 88;
  if (status === 'error') return 100;
  return 34;
}

export function getVerificationStatusLabel({ activeRecordId, status, summary }) {
  if (!activeRecordId) return '待保存，未发起核验';
  if (status === 'loading' && !summary) return '正在读取核验结果';
  if (summary?.status === 'failed') return '核验失败，需人工复核';
  if (summary?.status === 'skipped') return '已跳过核验';
  if (summary?.status === 'completed' && summary?.judgmentLabel) return summary.judgmentLabel;
  if (summary?.phase === 'searching_fast') return '快速初筛中';
  if (summary?.phase === 'searching_full') return '补全风险线索中';
  if (summary?.phase === 'summarizing') return 'AI 摘要整理中';
  if (summary?.status === 'running') return '公共风险核验中';
  if (summary?.status === 'pending') return '后台核验排队中';
  if (status === 'error') return '核验状态读取失败';
  return '后台核验进行中';
}

export function getVerificationTone(riskLevel, status) {
  if (status === 'error' || riskLevel === 'high') return 'danger';
  if (status === 'loading' || riskLevel === 'unknown' || riskLevel === 'medium') return 'warning';
  return 'stable';
}

export function buildWorkflowSteps({ form, activeRecordId, summary, reviews = [], activeTab }) {
  const hasInstitution = isFilled(form?.institutionName);
  const terminalStatus = TERMINAL_VERIFICATION_STATUSES.includes(summary?.status);
  const hasReview = Array.isArray(reviews) && reviews.length > 0;
  const isResult = activeTab === 'result';

  return [
    {
      id: 'institution',
      label: '机构录入',
      tab: 'institution',
      state: hasInstitution ? 'done' : 'active'
    },
    {
      id: 'verify',
      label: '公共风险核验',
      tab: 'verify',
      state: hasReview ? 'done' : terminalStatus ? 'review' : activeRecordId ? 'active' : 'waiting'
    },
    {
      id: 'assessment',
      label: '填写评估资料',
      tab: 'assessment',
      state: activeTab === 'assessment' ? 'active' : activeRecordId || isResult ? 'done' : 'waiting'
    },
    {
      id: 'result',
      label: '输出审批摘要',
      tab: 'result',
      state: hasReview ? 'done' : isResult ? 'active' : 'waiting'
    }
  ];
}

export function buildCommandCenterModel({
  form,
  result,
  displayResult,
  assessmentStage,
  activeRecordId,
  verificationLogStatus,
  latestVerificationSummary,
  verificationReviews = [],
  activeTab
}) {
  const institutionName = String(form?.institutionName || '').trim();
  const hasInstitution = institutionName.length > 0;
  const hasReview = Array.isArray(verificationReviews) && verificationReviews.length > 0;
  const progress = getVerificationProgress({
    activeRecordId,
    status: verificationLogStatus,
    summary: latestVerificationSummary
  });
  const verificationLabel = getVerificationStatusLabel({
    activeRecordId,
    status: verificationLogStatus,
    summary: latestVerificationSummary
  });

  if (!hasInstitution) {
    return {
      tone: 'draft',
      institutionLabel: '先录入机构名称',
      decisionLabel: '待录入机构',
      gradeLabel: '未生成',
      scoreLabel: '待录入',
      termLabel: '待生成',
      limitLabel: '待生成',
      assessmentLabel: '未开始打分',
      verificationLabel,
      progress,
      showFormalResult: false,
      primaryActionLabel: '保存并开始核验',
      steps: buildWorkflowSteps({ form, activeRecordId, summary: latestVerificationSummary, reviews: verificationReviews, activeTab })
    };
  }

  const finalResult = displayResult || result;
  const stageIsFinal = assessmentStage?.id === 'final' || hasReview;
  const decisionLabel = stageIsFinal
    ? finalResult.finalDecision
    : activeRecordId
      ? assessmentStage?.title || '预评估'
      : '待保存核验';

  return {
    tone: finalResult.finalGrade === 'E'
      ? 'danger'
      : assessmentStage?.tone === 'danger'
        ? 'danger'
        : finalResult.needsApproval || ['review_pending', 'verifying', 'saved'].includes(assessmentStage?.id)
          ? 'warning'
          : 'stable',
    institutionLabel: institutionName,
    decisionLabel,
    gradeLabel: stageIsFinal ? finalResult.finalGrade : `预估 ${finalResult.finalGrade}`,
    scoreLabel: `${finalResult.totalScore} 分`,
    termLabel: `${finalResult.maxTermDays} 天`,
    limitLabel: finalResult.suggestedLimit,
    assessmentLabel: stageIsFinal ? '最终评估' : '草稿预评估',
    verificationLabel,
    progress,
    showFormalResult: stageIsFinal,
    primaryActionLabel: activeRecordId ? '保存并更新核验' : '保存并开始核验',
    steps: buildWorkflowSteps({ form, activeRecordId, summary: latestVerificationSummary, reviews: verificationReviews, activeTab })
  };
}
