import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Cloud,
  CloudOff,
  Copy,
  Database,
  FileText,
  History,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import {
  BUSINESS_STAGE_LABELS,
  DEFAULT_FORM,
  PAYMENT_LABELS,
  PUBLIC_CREDIT_LABELS,
  QUALIFICATION_LABELS,
  evaluateCredit
} from './riskEngine';
import { getBusinessConfig } from './businessConfig';
import {
  createConfiguredAssessmentRepository,
  createLocalAssessmentRepository,
  REPOSITORY_MODES
} from './assessmentRepository';

const tabs = [
  { id: 'basic', label: '基础', icon: FileText },
  { id: 'purchase', label: '采购', icon: TrendingUp },
  { id: 'payment', label: '履约', icon: ClipboardCheck },
  { id: 'verify', label: '核验', icon: Search },
  { id: 'result', label: '结果', icon: ShieldCheck }
];

const BUSINESS_CONFIG = getBusinessConfig();
const formatMoney = (value) => `¥${Math.round(Number(value) || 0).toLocaleString('zh-CN')}`;
const formatDateTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const VERIFICATION_REVIEW_ACTION_LABELS = {
  accept_suggestion: '采用系统建议',
  manual_override: '人工改判',
  mark_reviewed: '仅记录复核'
};

function App() {
  const assessmentRepository = useMemo(() => createConfiguredAssessmentRepository(), []);
  const localFallbackRepository = useMemo(() => createLocalAssessmentRepository(), []);
  const [activeTab, setActiveTab] = useState('basic');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [history, setHistory] = useState([]);
  const [isRepositoryReady, setIsRepositoryReady] = useState(false);
  const [repositoryStatus, setRepositoryStatus] = useState('loading');
  const [repositoryMessage, setRepositoryMessage] = useState('正在载入评估数据');
  const [lastSyncedAt, setLastSyncedAt] = useState('');
  const [activeRecordId, setActiveRecordId] = useState('');
  const [verificationLogs, setVerificationLogs] = useState([]);
  const [verificationLogStatus, setVerificationLogStatus] = useState('idle');
  const [verificationReviews, setVerificationReviews] = useState([]);
  const [verificationReviewStatus, setVerificationReviewStatus] = useState('idle');
  const [toast, setToast] = useState('');
  const result = useMemo(() => evaluateCredit(form), [form]);
  const activeStepIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const isRemoteMode = assessmentRepository.mode === REPOSITORY_MODES.remote;
  const latestVerificationSummary = getVerificationSummary(verificationLogs[0]);

  const markRepositorySynced = (message = '已同步到远端') => {
    setRepositoryStatus('synced');
    setRepositoryMessage(message);
    setLastSyncedAt(new Date().toISOString());
  };

  useEffect(() => {
    let isActive = true;

    const hydrateRepositoryState = async () => {
      try {
        const [savedDraft, savedHistory] = await Promise.all([
          assessmentRepository.loadDraft(),
          assessmentRepository.listRecords()
        ]);
        if (!isActive) return;
        setForm(savedDraft);
        setHistory(savedHistory);
        markRepositorySynced(isRemoteMode ? '远端数据已载入' : '本地数据已载入');
      } catch {
        if (!isActive) return;
        const fallbackDraft = localFallbackRepository.loadDraft();
        const fallbackHistory = localFallbackRepository.listRecords();
        setForm(fallbackDraft);
        setHistory(fallbackHistory);
        setRepositoryStatus(isRemoteMode ? 'failed' : 'error');
        setRepositoryMessage(isRemoteMode ? '远端载入失败，已使用本机缓存' : '数据载入失败，已使用默认表单');
        setToast(isRemoteMode ? '远端载入失败，已切到本机缓存' : '数据载入失败，已使用默认表单');
      } finally {
        if (isActive) setIsRepositoryReady(true);
      }
    };

    hydrateRepositoryState();

    return () => {
      isActive = false;
    };
  }, [assessmentRepository, isRemoteMode, localFallbackRepository]);

  useEffect(() => {
    if (!isRepositoryReady) return undefined;

    const timer = window.setTimeout(async () => {
      try {
        setRepositoryStatus(isRemoteMode ? 'syncing' : 'saving');
        setRepositoryMessage(isRemoteMode ? '正在同步草稿' : '正在保存草稿');
        if (isRemoteMode) {
          localFallbackRepository.saveDraft(form);
        }
        await assessmentRepository.saveDraft(form);
        if (!isRemoteMode) localFallbackRepository.saveDraft(form);
        markRepositorySynced(isRemoteMode ? '草稿已同步' : '草稿已保存');
      } catch {
        if (isRemoteMode) {
          localFallbackRepository.saveDraft(form);
          setRepositoryStatus('failed');
          setRepositoryMessage('远端草稿同步失败，本机已保留');
        } else {
          setRepositoryStatus('error');
          setRepositoryMessage('本机草稿保存失败');
        }
      }
    }, assessmentRepository.mode === 'remote' ? 500 : 0);

    return () => window.clearTimeout(timer);
  }, [assessmentRepository, form, isRemoteMode, isRepositoryReady, localFallbackRepository]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updatePurchase = (index, value) => {
    setForm((current) => {
      const next = [...current.monthlyPurchases];
      next[index] = Number(value) || 0;
      return { ...current, monthlyPurchases: next };
    });
  };

  const saveRecord = async () => {
    try {
      setRepositoryStatus(isRemoteMode ? 'syncing' : 'saving');
      setRepositoryMessage(isRemoteMode ? '正在保存并同步评估记录' : '正在保存评估记录');
      const savedRecord = await assessmentRepository.saveRecord({ form, result });
      if (isRemoteMode) {
        localFallbackRepository.saveDraft(form);
        localFallbackRepository.saveRecordSnapshot(savedRecord);
      }
      setHistory(await assessmentRepository.listRecords());
      setActiveRecordId(savedRecord.id);
      setVerificationLogStatus(isRemoteMode ? 'loading' : 'unavailable');
      setVerificationReviews([]);
      setVerificationReviewStatus(isRemoteMode ? 'idle' : 'unavailable');
      markRepositorySynced(isRemoteMode ? '评估记录已同步' : '评估记录已保存');
      setToast(isRemoteMode ? '已保存，正在自动联网核验' : '已保存当前评估记录');
      setActiveTab(isRemoteMode ? 'verify' : 'result');
      refreshVerificationLogs(savedRecord.id);
      refreshVerificationReviews(savedRecord.id, { silent: true });
      if (isRemoteMode) {
        window.setTimeout(() => refreshVerificationLogs(savedRecord.id, { silent: true }), 3500);
        window.setTimeout(() => refreshVerificationLogs(savedRecord.id, { silent: true }), 7500);
        window.setTimeout(() => refreshVerificationLogs(savedRecord.id, { silent: true }), 12000);
      }
    } catch {
      if (isRemoteMode) {
        const fallbackRecord = localFallbackRepository.saveRecord({ form, result });
        localFallbackRepository.saveDraft(form);
        setHistory(localFallbackRepository.listRecords());
        setActiveRecordId(fallbackRecord.id);
        setVerificationLogs([]);
        setVerificationLogStatus('unavailable');
        setVerificationReviews([]);
        setVerificationReviewStatus('unavailable');
        setRepositoryStatus('failed');
        setRepositoryMessage('远端保存失败，本机已保存');
        setToast('远端保存失败，记录已保存在本机');
        setActiveTab('result');
      } else {
        setRepositoryStatus('error');
        setRepositoryMessage('本机保存失败');
        setToast('保存失败，请检查本机存储');
      }
    }
  };

  const resetForm = async () => {
    try {
      setRepositoryStatus(isRemoteMode ? 'syncing' : 'saving');
      setRepositoryMessage(isRemoteMode ? '正在重置远端草稿' : '正在重置表单');
      localFallbackRepository.resetDraft();
      setForm(await assessmentRepository.resetDraft());
      setActiveRecordId('');
      setVerificationLogs([]);
      setVerificationLogStatus('idle');
      setVerificationReviews([]);
      setVerificationReviewStatus('idle');
      markRepositorySynced(isRemoteMode ? '表单已重置并同步' : '表单已重置');
      setToast('表单已重置为示例状态');
      setActiveTab('basic');
    } catch {
      if (isRemoteMode) {
        setForm(localFallbackRepository.resetDraft());
        setRepositoryStatus('failed');
        setRepositoryMessage('远端重置失败，本机表单已重置');
        setToast('远端重置失败，本机表单已重置');
        setActiveTab('basic');
      } else {
        setRepositoryStatus('error');
        setRepositoryMessage('重置失败');
        setToast('重置失败，请检查持久化配置');
      }
    }
  };

  const loadRecord = async (record) => {
    try {
      const storedRecord = await assessmentRepository.loadRecord(record.id) || record;
      setForm(storedRecord.form);
      setActiveRecordId(storedRecord.id);
      setToast('已载入历史记录');
      setActiveTab('result');
      refreshVerificationLogs(storedRecord.id);
      refreshVerificationReviews(storedRecord.id);
    } catch {
      const fallbackRecord = localFallbackRepository.loadRecord(record.id) || record;
      if (fallbackRecord?.form) {
        setForm(fallbackRecord.form);
        setActiveRecordId(fallbackRecord.id);
        setVerificationLogStatus(isRemoteMode ? 'unavailable' : 'idle');
        setVerificationReviews([]);
        setVerificationReviewStatus(isRemoteMode ? 'unavailable' : 'idle');
        setToast(isRemoteMode ? '远端载入失败，已载入本机记录' : '已载入本机记录');
        setActiveTab('result');
      } else {
        setToast('载入失败，请稍后重试');
      }
    }
  };

  const refreshVerificationLogs = async (recordId = activeRecordId, options = {}) => {
    if (!recordId) {
      setVerificationLogs([]);
      setVerificationLogStatus('idle');
      return;
    }

    if (!isRemoteMode) {
      setVerificationLogs([]);
      setVerificationLogStatus('unavailable');
      return;
    }

    try {
      if (!options.silent) setVerificationLogStatus('loading');
      const logs = await assessmentRepository.listVerificationLogs(recordId);
      setVerificationLogs(logs);
      setVerificationLogStatus('ready');
    } catch {
      if (!options.silent) {
        setVerificationLogs([]);
        setVerificationLogStatus('error');
        setToast('核验日志读取失败');
      }
    }
  };

  const rerunVerification = async (recordId = activeRecordId) => {
    if (!recordId) {
      setToast('请先保存评估记录');
      return null;
    }

    if (!isRemoteMode) {
      setToast('本地模式暂不支持重新发起联网核验');
      return null;
    }

    try {
      setVerificationLogStatus('loading');
      const pendingLog = await assessmentRepository.rerunVerification(recordId);
      if (pendingLog) {
        setVerificationLogs((current) => [pendingLog, ...current.filter((item) => item.id !== pendingLog.id)]);
      }
      setVerificationLogStatus('ready');
      setToast('已重新发起联网核验');
      window.setTimeout(() => refreshVerificationLogs(recordId, { silent: true }), 3500);
      window.setTimeout(() => refreshVerificationLogs(recordId, { silent: true }), 7500);
      window.setTimeout(() => refreshVerificationLogs(recordId, { silent: true }), 12000);
      return pendingLog;
    } catch {
      setVerificationLogStatus('error');
      setToast('重新核验失败，请稍后重试');
      return null;
    }
  };

  const refreshVerificationReviews = async (recordId = activeRecordId, options = {}) => {
    if (!recordId) {
      setVerificationReviews([]);
      setVerificationReviewStatus('idle');
      return;
    }

    if (!isRemoteMode) {
      setVerificationReviews([]);
      setVerificationReviewStatus('unavailable');
      return;
    }

    try {
      if (!options.silent) setVerificationReviewStatus('loading');
      const reviews = await assessmentRepository.listVerificationReviews(recordId);
      setVerificationReviews(reviews);
      setVerificationReviewStatus('ready');
    } catch {
      if (!options.silent) {
        setVerificationReviews([]);
        setVerificationReviewStatus('error');
        setToast('确认日志读取失败');
      }
    }
  };

  const saveVerificationReview = async (review) => {
    if (!activeRecordId) {
      setToast('请先保存评估记录');
      return null;
    }

    if (!isRemoteMode) {
      setToast('本地模式暂不支持保存确认日志');
      return null;
    }

    try {
      setVerificationReviewStatus('saving');
      const savedReview = await assessmentRepository.saveVerificationReview(activeRecordId, review);
      setVerificationReviews((current) => [savedReview, ...current.filter((item) => item.id !== savedReview.id)]);
      setVerificationReviewStatus('ready');
      markRepositorySynced('核验确认日志已同步');
      setToast('已保存核验确认日志');
      return savedReview;
    } catch {
      setVerificationReviewStatus('error');
      setToast('确认日志保存失败，请稍后重试');
      return null;
    }
  };

  const uploadEvidenceAttachment = async (file) => {
    if (!activeRecordId) {
      setToast('请先保存评估记录');
      return null;
    }

    if (!isRemoteMode) {
      setToast('本地模式暂不支持上传证据附件');
      return null;
    }

    try {
      setVerificationReviewStatus('uploading');
      const attachment = await assessmentRepository.uploadEvidenceAttachment(activeRecordId, file);
      setVerificationReviewStatus('ready');
      setToast('证据附件已上传');
      return attachment;
    } catch {
      setVerificationReviewStatus('error');
      setToast('证据附件上传失败，请稍后重试');
      return null;
    }
  };

  const copyKeyword = async (keyword) => {
    try {
      await navigator.clipboard?.writeText(keyword);
      setToast('查询关键词已复制');
    } catch {
      setToast('当前浏览器不支持自动复制');
    }
  };

  const statusClass = result.finalGrade === 'E'
    ? 'danger'
    : result.needsApproval
      ? 'warning'
      : result.finalGrade === 'C' || result.finalGrade === 'D'
        ? 'caution'
        : 'stable';

  return (
    <main className="page-shell">
      <section className="phone-frame" aria-label="医美机构账期评估系统 H5 原型">
        <header className="app-header">
          <div>
            <p className="app-kicker">内部授信评估</p>
            <h1>医美机构账期评估</h1>
          </div>
          <div className="header-mark" aria-hidden="true">
            <Sparkles size={18} />
          </div>
        </header>

        <ResultCard result={result} statusClass={statusClass} />

        <CurrentInstitutionBar
          form={form}
          activeRecordId={activeRecordId}
          verificationLogStatus={verificationLogStatus}
          latestVerificationSummary={latestVerificationSummary}
        />

        <nav className="tab-bar" aria-label="评估步骤">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? 'step' : undefined}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={17} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <StepProgress activeStepIndex={activeStepIndex} />

        <div className="action-row">
          <button className="ghost-button" type="button" onClick={resetForm}>
            <RotateCcw size={16} />
            重置表单
          </button>
          <button className="primary-button" type="button" onClick={saveRecord}>
            <Save size={16} />
            保存当前评估
          </button>
        </div>

        <RepositoryStatusBadge
          mode={assessmentRepository.mode}
          status={repositoryStatus}
          message={repositoryMessage}
          lastSyncedAt={lastSyncedAt}
        />

        <section className="content-panel">
          {activeTab === 'basic' && (
            <BasicStep
              form={form}
              updateField={updateField}
              result={result}
              activeRecordId={activeRecordId}
              latestVerificationSummary={latestVerificationSummary}
              verificationLogStatus={verificationLogStatus}
              onSaveRecord={saveRecord}
              isRemoteMode={isRemoteMode}
            />
          )}
          {activeTab === 'purchase' && (
            <PurchaseStep form={form} updateField={updateField} updatePurchase={updatePurchase} result={result} />
          )}
          {activeTab === 'payment' && (
            <PaymentStep form={form} updateField={updateField} />
          )}
          {activeTab === 'verify' && (
            <VerifyStep
              form={form}
              updateField={updateField}
              result={result}
              copyKeyword={copyKeyword}
              activeRecordId={activeRecordId}
              verificationLogs={verificationLogs}
              verificationLogStatus={verificationLogStatus}
              refreshVerificationLogs={() => refreshVerificationLogs()}
              rerunVerification={() => rerunVerification()}
              verificationReviews={verificationReviews}
              verificationReviewStatus={verificationReviewStatus}
              refreshVerificationReviews={() => refreshVerificationReviews()}
              saveVerificationReview={saveVerificationReview}
              uploadEvidenceAttachment={uploadEvidenceAttachment}
              isRemoteMode={isRemoteMode}
            />
          )}
          {activeTab === 'result' && (
            <ResultStep
              result={result}
              history={history}
              loadRecord={loadRecord}
              activeRecordId={activeRecordId}
              verificationLogs={verificationLogs}
              verificationLogStatus={verificationLogStatus}
              refreshVerificationLogs={() => refreshVerificationLogs()}
              rerunVerification={() => rerunVerification()}
              isRemoteMode={isRemoteMode}
              latestVerificationSummary={latestVerificationSummary}
            />
          )}
        </section>

        <div className={`toast ${toast ? 'show' : ''}`} aria-live="polite">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      </section>
    </main>
  );
}

function RepositoryStatusBadge({ mode, status, message, lastSyncedAt }) {
  const modeLabel = mode === 'remote' ? '远端持久化' : '本地持久化';
  const StatusIcon = status === 'failed' || status === 'error' ? CloudOff : status === 'syncing' || status === 'saving' || status === 'loading' ? CircleDashed : Cloud;
  const statusLabel = {
    loading: '载入中',
    syncing: '同步中',
    saving: '同步中',
    synced: '已同步',
    failed: '同步失败',
    error: '同步失败'
  }[status] || '已同步';
  const syncedTime = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`repository-status ${status}`}>
      <StatusIcon size={15} />
      <div>
        <span>{modeLabel}</span>
        <small>{message || (syncedTime ? `最近同步 ${syncedTime}` : '等待同步')}</small>
      </div>
      <strong>{statusLabel}</strong>
    </div>
  );
}

function StepProgress({ activeStepIndex }) {
  return (
    <div className="step-progress" aria-label={`当前第 ${activeStepIndex + 1} 步，共 ${tabs.length} 步`}>
      <span>步骤 {activeStepIndex + 1} / {tabs.length}</span>
      <div>
        {tabs.map((tab, index) => (
          <i key={tab.id} className={index <= activeStepIndex ? 'done' : ''} />
        ))}
      </div>
    </div>
  );
}

function ResultCard({ result, statusClass }) {
  const firstReason = result.redlineReasons[0] || result.capReasons[0] || result.approvalReasons[0];

  return (
    <section className={`result-card ${statusClass}`} aria-live="polite">
      <div className="result-topline">
        <div>
          <span className="status-dot" />
          <span>{result.finalDecision}</span>
        </div>
        <strong>等级 {result.finalGrade}</strong>
      </div>
      <div className="result-grid">
        <Metric label="综合评分" value={`${result.totalScore} 分`} />
        <Metric label="最长账期" value={`${result.maxTermDays} 天`} />
        <Metric label="建议额度" value={formatMoney(result.suggestedLimit)} />
      </div>
      {firstReason && (
        <div className="reason-preview">
          <span>{result.baseGrade === result.finalGrade ? '关键原因' : `基础 ${result.baseGrade} → 最终 ${result.finalGrade}`}</span>
          <strong>{firstReason}</strong>
        </div>
      )}
      {result.redlineReasons.length > 0 && (
        <div className="inline-alert danger-text">
          <AlertTriangle size={15} />
          已触发准入红线，不进入常规授信。
        </div>
      )}
      {!result.redlineReasons.length && result.needsApproval && (
        <div className="inline-alert warning-text">
          <AlertTriangle size={15} />
          业务申请超过常规规则，需要特批确认。
        </div>
      )}
    </section>
  );
}

function CurrentInstitutionBar({ form, activeRecordId, verificationLogStatus, latestVerificationSummary }) {
  const institutionName = form.institutionName?.trim() || '未填写机构名称';
  const progress = getVerificationProgress({ activeRecordId, status: verificationLogStatus, summary: latestVerificationSummary });
  const statusLabel = getVerificationStatusLabel({ activeRecordId, status: verificationLogStatus, summary: latestVerificationSummary });

  return (
    <section className="current-institution-bar" aria-live="polite">
      <div>
        <span>当前机构</span>
        <strong>{institutionName}</strong>
        {form.creditCode && <small>统一社会信用代码 {form.creditCode}</small>}
      </div>
      <div className="verification-mini-status">
        <span>{statusLabel}</span>
        <i>
          <b style={{ width: `${progress}%` }} />
        </i>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BasicStep({
  form,
  updateField,
  result,
  activeRecordId,
  latestVerificationSummary,
  verificationLogStatus,
  onSaveRecord,
  isRemoteMode
}) {
  const termOverLimit = result.requestedTerm > result.maxTermDays && result.finalGrade !== 'E';
  const limitOverAverage = result.requestedLimit > result.stableMonthlyAverage && result.finalGrade !== 'E';
  const creditCodeCandidates = getCreditCodeCandidates(latestVerificationSummary);
  const verificationProgress = getVerificationProgress({
    activeRecordId,
    status: verificationLogStatus,
    summary: latestVerificationSummary
  });
  const verificationStatusLabel = getVerificationStatusLabel({
    activeRecordId,
    status: verificationLogStatus,
    summary: latestVerificationSummary
  });

  return (
    <div className="step-stack">
      <SectionTitle icon={FileText} title="机构基础信息" />
      <TextField
        label="机构名称"
        value={form.institutionName}
        onChange={(value) => updateField('institutionName', value)}
        placeholder="例如：杭州星澜医疗美容诊所"
      />
      <div className="basic-verification-launch">
        <div>
          <strong>{isRemoteMode ? '保存并启动后台核验' : '保存当前评估'}</strong>
          <span>{isRemoteMode ? verificationStatusLabel : '本地模式不会发起联网核验'}</span>
          <i><b style={{ width: `${verificationProgress}%` }} /></i>
        </div>
        <button type="button" onClick={onSaveRecord} disabled={!form.institutionName.trim()}>
          <Save size={15} />
          保存并核验
        </button>
      </div>
      <TextField label="统一社会信用代码" value={form.creditCode} onChange={(value) => updateField('creditCode', value)} placeholder="可暂不填写" />
      <CreditCodeSuggestions
        candidates={creditCodeCandidates}
        hasActiveRecord={Boolean(activeRecordId)}
        onApply={(value) => updateField('creditCode', value)}
      />
      <SelectField
        label="经营 / 合作阶段"
        value={form.businessStage}
        onChange={(value) => updateField('businessStage', value)}
        options={BUSINESS_STAGE_LABELS}
      />
      <div className="split-row">
        <SwitchField label="已有完成回款订单" checked={form.hasPaidOrders} onChange={(value) => updateField('hasPaidOrders', value)} />
        <NumberField label="回款订单数" value={form.paidOrderCount} onChange={(value) => updateField('paidOrderCount', value)} min="0" />
      </div>
      <div className="split-row">
        <NumberField
          label="申请账期天数"
          value={form.requestedTerm}
          onChange={(value) => updateField('requestedTerm', value)}
          min="0"
          suffix="天"
          helperText={termOverLimit ? `超过系统建议 ${result.maxTermDays} 天，需特批` : `当前等级建议不超过 ${result.maxTermDays} 天`}
          tone={termOverLimit ? 'warning' : 'neutral'}
        />
        <NumberField
          label="申请额度"
          value={form.requestedLimit}
          onChange={(value) => updateField('requestedLimit', value)}
          min="0"
          prefix="¥"
          helperText={limitOverAverage ? `超过稳定月均 ${formatMoney(result.stableMonthlyAverage)}，需特批` : `额度上限 ${formatMoney(result.creditLimitCap)}`}
          tone={limitOverAverage ? 'warning' : 'neutral'}
        />
      </div>

      <SectionTitle icon={BadgeCheck} title="核心资质" />
      <SelectField
        label="资质状态"
        value={form.qualificationStatus}
        onChange={(value) => updateField('qualificationStatus', value)}
        options={QUALIFICATION_LABELS}
      />
      <SwitchField label="营业执照有效" checked={form.licenseValid} onChange={(value) => updateField('licenseValid', value)} />
      <SwitchField label="医疗机构资质有效" checked={form.medicalLicenseValid} onChange={(value) => updateField('medicalLicenseValid', value)} />
      <SwitchField label="诊疗科目包含医疗美容" checked={form.beautyScopeIncluded} onChange={(value) => updateField('beautyScopeIncluded', value)} />
      <SwitchField label="主体 / 地址 / 合同 / 付款 / 收货一致" checked={form.subjectConsistent} onChange={(value) => updateField('subjectConsistent', value)} />
      {(!form.licenseValid || !form.medicalLicenseValid || !form.beautyScopeIncluded || form.qualificationStatus === 'coreMissing') && (
        <FieldAlert tone="danger" text="核心资质触发准入红线，系统会直接判定为不建议授信。" />
      )}
      {form.qualificationStatus === 'incomplete' && (
        <FieldAlert tone="warning" text="资质资料不完整会限制最高等级为 C，并进入特批原因。" />
      )}
      <TextAreaField label="备注" value={form.notes} onChange={(value) => updateField('notes', value)} placeholder="可记录业务背景、客户口径、需人工确认事项" />

      <TagStrip items={[result.purchaseHealthTip, result.paymentTip, result.creditTip]} />
    </div>
  );
}

function CreditCodeSuggestions({ candidates, hasActiveRecord, onApply }) {
  if (!hasActiveRecord) {
    return <FieldAlert tone="warning" text="填写机构名称后点击“保存并核验”，系统会尝试通过官方企业信用接口识别统一社会信用代码候选。" />;
  }

  if (!candidates.length) {
    return <FieldAlert tone="warning" text="官方企业信用接口暂未返回统一社会信用代码候选，可继续人工填写或确认接口配置。" />;
  }

  return (
    <div className="credit-code-suggestions">
      <span className="field-label">官方企业信用候选</span>
      {candidates.map((candidate) => (
        <div className="credit-code-candidate" key={`${candidate.value}-${candidate.url || candidate.title}`}>
          <div>
            <strong>{candidate.value}</strong>
            <small>{[candidate.source, candidate.title].filter(Boolean).join(' · ') || '官方企业信用接口'}</small>
          </div>
          <button type="button" onClick={() => onApply(candidate.value)}>
            采用
          </button>
        </div>
      ))}
    </div>
  );
}

function PurchaseStep({ form, updateField, updatePurchase, result }) {
  return (
    <div className="step-stack">
      <SectionTitle icon={TrendingUp} title="最近 6 个月已回款采购" />
      <div className="month-grid">
        {form.monthlyPurchases.map((value, index) => (
          <NumberField
            key={index}
            label={`第 ${index + 1} 月采购金额`}
            value={value}
            onChange={(nextValue) => updatePurchase(index, nextValue)}
            min="0"
            prefix="¥"
          />
        ))}
      </div>
      <div className="split-row">
        <NumberField label="最长采购断档" value={form.longestGapDays} onChange={(value) => updateField('longestGapDays', value)} min="0" suffix="天" />
        <SwitchField label="存在单月异常大单" checked={form.abnormalLargeOrder} onChange={(value) => updateField('abnormalLargeOrder', value)} />
      </div>
      <div className="summary-band">
        <Metric label="采购月份数" value={`${result.purchaseMonths} / 6`} />
        <Metric label="6 个月合计" value={formatMoney(result.monthlyTotal)} />
        <Metric label="稳定月均销量" value={formatMoney(result.stableMonthlyAverage)} />
        <Metric label="采购健康度" value={result.purchaseHealthTip} />
      </div>
      <TagStrip items={[result.purchaseHealthTip, `采购得分 ${result.componentScores.purchase} / 40`]} />
    </div>
  );
}

function PaymentStep({ form, updateField }) {
  return (
    <div className="step-stack">
      <SectionTitle icon={ClipboardCheck} title="付款履约" />
      <SwitchField label="当前是否有逾期" checked={form.hasCurrentOverdue} onChange={(value) => updateField('hasCurrentOverdue', value)} danger />
      {form.hasCurrentOverdue && (
        <FieldAlert tone="danger" text="当前逾期未结清是准入红线，结果会直接变为 E / 不建议授信。" />
      )}
      <NumberField label="当前逾期金额" value={form.currentOverdueAmount} onChange={(value) => updateField('currentOverdueAmount', value)} min="0" prefix="¥" />
      <div className="split-row">
        <NumberField label="近 6 月超账期次数" value={form.overTermCount6m} onChange={(value) => updateField('overTermCount6m', value)} min="0" />
        <NumberField label="最大超账期天数" value={form.maxOverTermDays} onChange={(value) => updateField('maxOverTermDays', value)} min="0" suffix="天" />
      </div>
      <SelectField
        label="历史超账期情况"
        value={form.historicalOverdue}
        onChange={(value) => updateField('historicalOverdue', value)}
        options={PAYMENT_LABELS}
      />
      <SwitchField label="存在对账争议" checked={form.reconciliationDispute} onChange={(value) => updateField('reconciliationDispute', value)} />
      {(form.historicalOverdue !== 'none' || form.reconciliationDispute) && (
        <FieldAlert tone="warning" text="历史超账期或对账争议不会必然拒绝，但会触发封顶或特批。" />
      )}
    </div>
  );
}

function VerifyStep({
  form,
  updateField,
  result,
  copyKeyword,
  activeRecordId,
  verificationLogs,
  verificationLogStatus,
  refreshVerificationLogs,
  rerunVerification,
  verificationReviews,
  verificationReviewStatus,
  refreshVerificationReviews,
  saveVerificationReview,
  uploadEvidenceAttachment,
  isRemoteMode
}) {
  const latestSummary = getVerificationSummary(verificationLogs[0]);
  const latestLog = verificationLogs[0];

  return (
    <div className="step-stack">
      <SectionTitle icon={Search} title="公共风险核验" />
      <VerificationWorkbenchHeader
        activeRecordId={activeRecordId}
        summary={latestSummary}
        latestLog={latestLog}
        status={verificationLogStatus}
        isRemoteMode={isRemoteMode}
        reviewCount={verificationReviews.length}
      />
      <CreditVerificationPanel
        activeRecordId={activeRecordId}
        form={form}
        result={result}
        summary={latestSummary}
        logs={verificationLogs}
        status={verificationLogStatus}
        onRefresh={refreshVerificationLogs}
        onRerun={rerunVerification}
        isRemoteMode={isRemoteMode}
        updateField={updateField}
      />
      <VerificationReviewPanel
        activeRecordId={activeRecordId}
        summary={latestSummary}
        latestLog={latestLog}
        reviews={verificationReviews}
        status={verificationReviewStatus}
        onRefresh={refreshVerificationReviews}
        onSave={saveVerificationReview}
        onUploadAttachment={uploadEvidenceAttachment}
        isRemoteMode={isRemoteMode}
        form={form}
        updateField={updateField}
      />
      <ManualRiskInputPanel
        form={form}
        updateField={updateField}
      />
      <VerificationKeywordPanel result={result} copyKeyword={copyKeyword} />
    </div>
  );
}

function VerificationWorkbenchHeader({ activeRecordId, summary, latestLog, status, isRemoteMode, reviewCount }) {
  const progress = getVerificationProgress({ activeRecordId, status, summary });
  const statusLabel = getVerificationStatusLabel({ activeRecordId, status, summary });
  const latestAt = latestLog?.finishedAt || latestLog?.createdAt || '';
  const tone = getVerificationTone(summary?.riskLevel, status);

  return (
    <div className={`verification-workbench ${tone}`}>
      <div className="verification-workbench-head">
        <div>
          <CircleDashed size={18} />
          <span>智谱公开信息核验</span>
        </div>
        <strong>{isRemoteMode ? statusLabel : '本地模式不发起联网核验'}</strong>
      </div>
      <div className="verification-progress-row">
        <span>进度 {progress}%</span>
        <i><b style={{ width: `${progress}%` }} /></i>
      </div>
      <div className="verification-meta-grid">
        <Metric label="核验方式" value="轻量搜索" />
        <Metric label="核验范围" value="7 个关键词" />
        <Metric label="最近核验" value={latestAt ? formatDateTime(latestAt) : '未生成'} />
        <Metric label="确认日志" value={`${reviewCount} 条`} />
      </div>
      <small>联网结果仅作为公共风险线索；只有保存人工确认日志后，才会写入公共信用字段。</small>
    </div>
  );
}

function CreditVerificationPanel({ activeRecordId, form, result, summary, logs, status, onRefresh, onRerun, isRemoteMode, updateField }) {
  const latestLog = logs[0];
  const tone = getVerificationTone(summary?.riskLevel, status);
  const suggestedStatus = summary?.suggestedPublicCreditStatus;
  const suggestedStatusLabel = suggestedStatus ? PUBLIC_CREDIT_LABELS[suggestedStatus] : '';
  const canApplySuggestion = suggestedStatus && suggestedStatus !== 'unknown';
  const creditCodeCandidates = getCreditCodeCandidates(summary);
  const businessProfile = summary?.businessProfile || null;
  const deepVerification = getDeepVerificationRecommendation({
    form,
    result,
    summary,
    highLimit: BUSINESS_CONFIG.deepVerificationHighLimit
  });

  const headline = !isRemoteMode
    ? '当前为本地模式，未发起联网核验'
    : !activeRecordId
      ? '保存评估后自动开始联网核验'
      : status === 'loading'
        ? '正在读取核验结果'
        : summary?.judgmentLabel || (latestLog ? '核验结果整理中' : '已提交核验，等待结果');

  const description = summary?.conclusion || (
    activeRecordId
      ? '后台已收到保存记录，稍后会显示智谱查询后的结构化判断。'
      : '请先填写机构名称并保存当前评估，系统会自动查询推荐关键词。'
  );

  return (
    <div className={`credit-verification-panel ${tone}`}>
      <div className="credit-verification-head">
        <div>
          <Search size={18} />
          <span>公共风险线索</span>
        </div>
        <strong>{headline}</strong>
      </div>
      <p>{description}</p>
      {summary?.recommendation && (
        <div className="verification-advice">
          <span>系统建议</span>
          <strong>{summary.recommendation}</strong>
          {canApplySuggestion && <small>请在下方“核验人工确认”里采用建议或人工改判，保存后再写入公共信用状态。</small>}
        </div>
      )}
      <div className="verification-facts">
        <Metric label="搜索结果" value={`${summary?.sourceCount ?? latestLog?.rawResultCount ?? 0} 条`} />
        <Metric label="匹配证据" value={`${summary?.matchedSourceCount ?? 0} 条`} />
      </div>
      {deepVerification.shouldShow && (
        <DeepVerificationPrompt
          businessProfile={businessProfile}
          candidateCount={creditCodeCandidates.length}
          reasons={deepVerification.reasons}
        />
      )}
      {summary?.riskTags?.length > 0 && <TagStrip items={summary.riskTags} tone="warning" />}
      {canApplySuggestion && <FieldAlert tone="warning" text={`当前建议为“${suggestedStatusLabel}”，需通过人工确认日志采用，不会自动改写风控输入。`} />}
      {creditCodeCandidates.length > 0 && (
        <div className="credit-code-suggestions compact">
          <span className="field-label">官方企业信用代码候选</span>
          {creditCodeCandidates.map((candidate) => (
            <div className="credit-code-candidate" key={`${candidate.value}-${candidate.url || candidate.title}`}>
              <div>
                <strong>{candidate.value}</strong>
                <small>{candidate.source || '官方企业信用接口'}</small>
              </div>
              <button type="button" onClick={() => updateField('creditCode', candidate.value)}>
                采用
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="verification-action-row">
        <button className="verification-refresh-button" type="button" onClick={onRefresh} disabled={!isRemoteMode || !activeRecordId || status === 'loading'}>
          刷新结果
        </button>
        <button className="verification-refresh-button primary" type="button" onClick={onRerun} disabled={!isRemoteMode || !activeRecordId || status === 'loading'}>
          重新核验
        </button>
      </div>
      {summary?.status === 'completed' && !summary?.evidenceSummaries?.length && (
        <div className="verification-empty-state">
          <CheckCircle2 size={16} />
          <span>未发现与机构名称直接匹配的明显负面风险线索。</span>
        </div>
      )}
      {summary?.evidenceSummaries?.length > 0 && (
        <div className="evidence-list">
          {summary.evidenceSummaries.slice(0, 4).map((item) => (
            <a className="evidence-item" href={item.url || '#'} target="_blank" rel="noreferrer" key={`${item.category}-${item.url || item.title}`}>
              <span>{item.category}</span>
              <strong>{item.title || '未命名来源'}</strong>
              <small>{[item.source, item.publishDate].filter(Boolean).join(' · ') || '来源待确认'}</small>
              {item.snippet && <p>{item.snippet}</p>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function DeepVerificationPrompt({ businessProfile, candidateCount, reasons }) {
  const registryStatus = businessProfile?.registryStatus || 'unconfigured';
  const statusLabel = getOfficialRegistryStatusLabel(registryStatus);
  const message = registryStatus === 'unconfigured'
    ? '尚未接入企查查 / 天眼查等授权工商接口，不影响轻量联网核验'
    : businessProfile?.registryMessage || '未配置官方企业信用接口';
  const provider = businessProfile?.registryProvider || 'official_registry';

  return (
    <div className={`deep-verification-prompt ${registryStatus}`}>
      <div>
        <span>授权工商深度核验</span>
        <strong>建议启用 · {statusLabel}</strong>
        <small>{message} · 候选 {candidateCount} 个 · {provider}</small>
      </div>
      <TagStrip items={reasons} tone="warning" />
      <small>当前仅做触发提示；未配置供应商 Key 前不会发起授权工商核验。</small>
    </div>
  );
}

function ManualRiskInputPanel({ form, updateField }) {
  return (
    <div className="manual-risk-panel">
      <div className="verification-log-header">
        <div>
          <ShieldCheck size={17} />
          <strong>人工确认后的风控输入</strong>
        </div>
      </div>
      <p>以下字段会影响最终授信判断。联网搜索只提供线索，请在人工确认或授权接口核实后再调整。</p>
      <SelectField
        label="公共信用状态"
        value={form.publicCreditStatus}
        onChange={(value) => updateField('publicCreditStatus', value)}
        options={PUBLIC_CREDIT_LABELS}
      />
      <SwitchField label="命中失信被执行人" checked={form.dishonestyHit} onChange={(value) => updateField('dishonestyHit', value)} danger />
      <SwitchField label="命中严重违法失信" checked={form.seriousIllegalHit} onChange={(value) => updateField('seriousIllegalHit', value)} danger />
      <SwitchField label="存在重大医美处罚" checked={form.majorMedicalPenalty} onChange={(value) => updateField('majorMedicalPenalty', value)} />
      <SwitchField label="疑似超范围 / 生活美容注射" checked={form.outOfScopeOperation} onChange={(value) => updateField('outOfScopeOperation', value)} danger />
      {(form.dishonestyHit || form.seriousIllegalHit || form.outOfScopeOperation || form.publicCreditStatus === 'serious') && (
        <FieldAlert tone="danger" text="公共信用或经营范围命中红线，系统会停止常规授信。" />
      )}
      {(form.publicCreditStatus === 'unknown' || form.majorMedicalPenalty) && (
        <FieldAlert tone="warning" text="未查询公共信用或存在重大医美处罚，需要人工核验和特批说明。" />
      )}
      <TextAreaField label="查询备注" value={form.verificationNotes} onChange={(value) => updateField('verificationNotes', value)} placeholder="记录人工查询渠道、截图编号或待补资料" />
    </div>
  );
}

function VerificationKeywordPanel({ result, copyKeyword }) {
  return (
    <div className="verification-module">
      <div>
        <Database size={17} />
        <strong>查询关键词</strong>
        <span>默认使用智谱轻量搜索查询 7 个风险关键词。</span>
      </div>
      <button type="button" onClick={() => copyKeyword(result.queryKeywords.join('\n'))}>
        复制全部
      </button>
      <div className="keyword-list">
        <span className="field-label">推荐查询关键词</span>
        {result.queryKeywords.map((item) => (
          <button type="button" key={item} onClick={() => copyKeyword(item)}>
            <Copy size={14} />
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function EvidenceAttachmentInput({ files, onChange, disabled }) {
  return (
    <label className={`evidence-attachment-input ${disabled ? 'disabled' : ''}`}>
      <span className="field-label">证据附件</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        multiple
        disabled={disabled}
        onChange={(event) => onChange(Array.from(event.target.files || []).slice(0, 6))}
      />
      <small>支持截图或 PDF，单个文件不超过 10MB；保存确认日志时上传到私有证据库。</small>
      {files.length > 0 && (
        <div className="selected-attachment-list">
          {files.map((file) => (
            <span key={`${file.name}-${file.size}`}>{file.name}</span>
          ))}
        </div>
      )}
    </label>
  );
}

function VerificationReviewPanel({
  activeRecordId,
  summary,
  latestLog,
  reviews,
  status,
  onRefresh,
  onSave,
  onUploadAttachment,
  isRemoteMode,
  form,
  updateField
}) {
  const suggestedStatus = summary?.suggestedPublicCreditStatus || 'unknown';
  const initialAction = suggestedStatus !== 'unknown' ? 'accept_suggestion' : 'mark_reviewed';
  const [action, setAction] = useState(initialAction);
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerDecision, setReviewerDecision] = useState(suggestedStatus !== 'unknown' ? suggestedStatus : form.publicCreditStatus);
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (suggestedStatus !== 'unknown' && !reviews.length && action === 'mark_reviewed') {
      setAction('accept_suggestion');
    }
    if (action === 'accept_suggestion' && suggestedStatus !== 'unknown') {
      setReviewerDecision(suggestedStatus);
    }
  }, [action, reviews.length, suggestedStatus]);

  const isSaving = status === 'saving';
  const isUploading = status === 'uploading';
  const canSave = isRemoteMode && activeRecordId && !isSaving && !isUploading;
  const latestReview = reviews[0];

  const handleSave = async () => {
    const trimmedReviewer = reviewerName.trim();
    if (!trimmedReviewer) {
      setFormError('请填写复核人。');
      return;
    }
    if (!reviewerDecision) {
      setFormError('请选择确认后的公共信用状态。');
      return;
    }

    setFormError('');
    const uploadedAttachments = [];
    for (const file of evidenceFiles) {
      const attachment = await onUploadAttachment(file);
      if (!attachment) {
        setFormError('证据附件上传失败，请稍后重试。');
        return;
      }
      uploadedAttachments.push(attachment);
    }

    const appliedFields = reviewerDecision !== form.publicCreditStatus
      ? { publicCreditStatus: reviewerDecision }
      : {};
    const savedReview = await onSave({
      action,
      reviewerName: trimmedReviewer,
      reviewerDecision,
      previousPublicCreditStatus: form.publicCreditStatus,
      suggestedPublicCreditStatus: suggestedStatus,
      verificationLogId: latestLog?.id || '',
      evidenceUrl,
      evidenceNote,
      evidenceAttachments: uploadedAttachments,
      verificationSnapshot: summary || {},
      appliedFields
    });

    if (!savedReview) return;
    if (appliedFields.publicCreditStatus) {
      updateField('publicCreditStatus', appliedFields.publicCreditStatus);
    }
    setEvidenceUrl('');
    setEvidenceNote('');
    setEvidenceFiles([]);
  };

  const panelText = !isRemoteMode
    ? '本地模式不保存远端确认日志。'
    : !activeRecordId
      ? '保存评估记录后，可对联网核验结果做人工确认。'
      : latestReview
        ? `最近确认：${VERIFICATION_REVIEW_ACTION_LABELS[latestReview.action] || latestReview.action} · ${latestReview.reviewerName || '未填写复核人'}`
        : '暂无人工确认记录。';

  return (
    <div className="verification-review-panel">
      <div className="verification-log-header">
        <div>
          <ClipboardCheck size={17} />
          <strong>核验人工确认</strong>
        </div>
        <button type="button" onClick={onRefresh} disabled={!isRemoteMode || !activeRecordId || status === 'loading'}>
          刷新
        </button>
      </div>
      <p>{panelText}</p>
      <SelectField
        label="确认动作"
        value={action}
        onChange={(value) => setAction(value)}
        options={VERIFICATION_REVIEW_ACTION_LABELS}
      />
      <div className="split-row">
        <TextField
          label="复核人"
          value={reviewerName}
          onChange={setReviewerName}
          placeholder="例如：王经理"
        />
        <SelectField
          label="确认后公共信用"
          value={reviewerDecision}
          onChange={setReviewerDecision}
          options={PUBLIC_CREDIT_LABELS}
        />
      </div>
      <TextField
        label="证据链接 / 截图编号"
        value={evidenceUrl}
        onChange={setEvidenceUrl}
        placeholder="可填截图编号或 https://..."
      />
      <EvidenceAttachmentInput
        files={evidenceFiles}
        onChange={setEvidenceFiles}
        disabled={!isRemoteMode || !activeRecordId || isSaving || isUploading}
      />
      <TextAreaField
        label="复核说明"
        value={evidenceNote}
        onChange={setEvidenceNote}
        placeholder="记录采用建议、人工改判理由、截图位置或审批备注"
      />
      {formError && <FieldAlert tone="warning" text={formError} />}
      <button className="verification-apply-button" type="button" onClick={handleSave} disabled={!canSave}>
        {isUploading ? '正在上传证据附件' : isSaving ? '正在保存确认日志' : '保存确认日志'}
      </button>
      {reviews.length > 0 && (
        <div className="verification-review-list">
          {reviews.slice(0, 4).map((review) => (
            <div className="verification-review-item" key={review.id}>
              <div>
                <strong>{VERIFICATION_REVIEW_ACTION_LABELS[review.action] || review.action}</strong>
                <span>{PUBLIC_CREDIT_LABELS[review.reviewerDecision] || review.reviewerDecision}</span>
              </div>
              <small>{review.reviewerName} · {new Date(review.createdAt).toLocaleString('zh-CN', { hour12: false })}</small>
              {review.evidenceUrl && <small>{review.evidenceUrl}</small>}
              {review.evidenceAttachments?.length > 0 && (
                <div className="evidence-attachment-list">
                  {review.evidenceAttachments.map((attachment) => (
                    <a href={attachment.signedUrl || '#'} target="_blank" rel="noreferrer" key={attachment.id || attachment.path}>
                      {attachment.fileName || '证据附件'}
                    </a>
                  ))}
                </div>
              )}
              {review.evidenceNote && <p>{review.evidenceNote}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultStep({
  result,
  history,
  loadRecord,
  activeRecordId,
  verificationLogs,
  verificationLogStatus,
  refreshVerificationLogs,
  rerunVerification,
  isRemoteMode,
  latestVerificationSummary
}) {
  const riskItems = [
    ...result.redlineReasons,
    ...result.capReasons,
    ...result.approvalReasons,
    ...result.extraRiskReasons,
    result.purchaseHealthTip,
    result.paymentTip,
    result.creditTip
  ].filter(Boolean);

  return (
    <div className="step-stack">
      <SectionTitle icon={ShieldCheck} title="最终结论" />
      <div className="decision-panel">
        <div>
          <span>最终判断</span>
          <strong>{result.finalDecision}</strong>
        </div>
        <div>
          <span>最终等级</span>
          <strong>{result.finalGrade}</strong>
        </div>
        <div>
          <span>综合评分</span>
          <strong>{result.totalScore} 分</strong>
        </div>
      </div>

      <div className="summary-band">
        <Metric label="系统建议账期" value={`${result.maxTermDays} 天`} />
        <Metric label="业务申请账期" value={`${result.requestedTerm} 天`} />
        <Metric label="系统建议额度" value={formatMoney(result.suggestedLimit)} />
        <Metric label="业务申请额度" value={formatMoney(result.requestedLimit)} />
        <Metric label="额度上限" value={formatMoney(result.creditLimitCap)} />
        <Metric label="稳定月均销量" value={formatMoney(result.stableMonthlyAverage)} />
      </div>

      {result.needsApproval && (
        <div className="approval-box">
          <strong>需要特批</strong>
          <span>请结合超规则原因、回款证据和人工核验结果审批。</span>
          <TagStrip items={result.approvalReasons} tone="warning" />
        </div>
      )}

      <div className="risk-list">
        <span className="field-label">系统原因</span>
        <TagStrip items={riskItems.length ? riskItems : ['未发现明显风险标签']} />
      </div>

      {latestVerificationSummary && (
        <div className={`verification-result-summary ${getVerificationTone(latestVerificationSummary.riskLevel)}`}>
          <strong>联网核验判断：{latestVerificationSummary.judgmentLabel}</strong>
          <p>{latestVerificationSummary.conclusion}</p>
          {latestVerificationSummary.riskTags?.length > 0 && <TagStrip items={latestVerificationSummary.riskTags} tone="warning" />}
        </div>
      )}

      <div className="next-actions">
        <strong>后续建议</strong>
        <p>{result.finalGrade === 'E' ? '先补齐准入红线问题，再重新评估。' : result.needsApproval ? '进入特批流程，并补充人工核验截图和业务说明。' : '可按系统建议账期与额度推进授信。'}</p>
      </div>

      <VerificationLogPanel
        activeRecordId={activeRecordId}
        logs={verificationLogs}
        status={verificationLogStatus}
        onRefresh={refreshVerificationLogs}
        onRerun={rerunVerification}
        isRemoteMode={isRemoteMode}
      />

      <HistoryList history={history} loadRecord={loadRecord} />
    </div>
  );
}

function VerificationLogPanel({ activeRecordId, logs, status, onRefresh, onRerun, isRemoteMode }) {
  const latestLog = logs[0];
  const statusText = {
    pending: '等待核验',
    running: '核验中',
    completed: '已完成',
    failed: '失败',
    skipped: '已跳过'
  };
  const panelText = !isRemoteMode
    ? '本地模式不产生后台核验日志。'
    : !activeRecordId
      ? '保存评估记录后，会在这里显示后台联网核验状态。'
      : status === 'loading'
        ? '正在读取后台核验日志。'
        : status === 'error'
          ? '核验日志读取失败，请稍后重试。'
          : status === 'unavailable'
            ? '当前记录保存在本机，暂无远端核验日志。'
            : !latestLog
              ? '已提交保存，后台核验日志生成中。'
              : `最近一次核验：${statusText[latestLog.status] || latestLog.status}`;

  return (
    <div className={`verification-log-panel ${status}`}>
      <div className="verification-log-header">
        <div>
          <Search size={17} />
          <strong>后台联网核验</strong>
        </div>
        <div className="verification-log-actions">
          <button type="button" onClick={onRefresh} disabled={!isRemoteMode || !activeRecordId || status === 'loading'}>
            刷新
          </button>
          <button type="button" onClick={onRerun} disabled={!isRemoteMode || !activeRecordId || status === 'loading'}>
            重新核验
          </button>
        </div>
      </div>
      <p>{panelText}</p>
      {logs.length > 0 && (
        <div className="verification-log-list">
          {logs.map((log) => (
            <div className="verification-log-item" key={log.id}>
              <div>
                <b className={`verification-status ${log.status}`}>{statusText[log.status] || log.status}</b>
                <span>{log.provider || 'zhipu_web_search'} · {log.rawResultCount || 0} 条结果</span>
              </div>
              <VerificationLogSummaryText log={log} />
              {log.riskTags?.length > 0 && <TagStrip items={log.riskTags} tone="warning" />}
              {log.errorMessage && <FieldAlert tone="warning" text={log.errorMessage} />}
              {log.queryKeywords?.length > 0 && (
                <small>{log.queryKeywords.slice(0, 3).join(' / ')}</small>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getVerificationSummary(log) {
  return log?.verificationSummary || log?.extractedFlags?.verificationSummary || null;
}

function getCreditCodeCandidates(summary) {
  const candidates = summary?.businessProfile?.creditCodeCandidates;
  return Array.isArray(candidates) ? candidates : [];
}

function getDeepVerificationRecommendation({ form, result, summary, highLimit = BUSINESS_CONFIG.deepVerificationHighLimit }) {
  const reasons = [];
  const requestedLimit = Number(result?.requestedLimit || form?.requestedLimit || 0);
  const riskTags = Array.isArray(summary?.riskTags) ? summary.riskTags : [];
  const matchedSourceCount = Number(summary?.matchedSourceCount || 0);
  const suggestedPublicCreditStatus = summary?.suggestedPublicCreditStatus || '';
  const hasRiskEvidence = matchedSourceCount > 0
    || riskTags.length > 0
    || ['medium', 'serious'].includes(suggestedPublicCreditStatus)
    || ['medium', 'high'].includes(summary?.riskLevel || '');

  if (requestedLimit >= highLimit) {
    reasons.push(`申请额度达到高额度阈值 ${formatMoney(highLimit)} 以上`);
  }
  if (hasRiskEvidence) {
    reasons.push('联网核验发现需复核风险线索');
  }
  if (['new60NoRepayment', 'under3Months', 'threeToSixMonths'].includes(form?.businessStage)) {
    reasons.push('合作未满 6 个月');
  }
  if (result?.needsApproval) {
    reasons.push('当前评估需要特批');
  }

  return {
    shouldShow: reasons.length > 0,
    reasons
  };
}

function getOfficialRegistryStatusLabel(status) {
  return ({
    completed: '已返回工商候选',
    empty: '未返回匹配候选',
    failed: '接口查询失败',
    unconfigured: '待接入'
  })[status] || '等待接口结果';
}

function VerificationLogSummaryText({ log }) {
  const summary = getVerificationSummary(log);
  if (!summary?.judgmentLabel) return null;
  return <small>{summary.judgmentLabel}：{summary.conclusion}</small>;
}

function getVerificationProgress({ activeRecordId, status, summary }) {
  if (!activeRecordId) return 0;
  if (summary?.status === 'completed') return 100;
  if (summary?.status === 'failed' || summary?.status === 'skipped') return 100;
  if (summary?.status === 'pending') return 35;
  if (status === 'loading') return 65;
  if (status === 'ready') return 80;
  if (status === 'error') return 100;
  return 45;
}

function getVerificationStatusLabel({ activeRecordId, status, summary }) {
  if (!activeRecordId) return '待保存，未发起核验';
  if (status === 'loading') return '正在读取核验结果';
  if (summary?.judgmentLabel) return summary.judgmentLabel;
  if (summary?.status === 'pending') return '后台核验排队中';
  if (summary?.status === 'failed') return '核验失败，需人工复核';
  if (status === 'error') return '核验状态读取失败';
  return '后台核验进行中';
}

function getVerificationTone(riskLevel, status) {
  if (status === 'error' || riskLevel === 'high') return 'danger';
  if (status === 'loading' || riskLevel === 'unknown' || riskLevel === 'medium') return 'warning';
  return 'stable';
}

function HistoryList({ history, loadRecord }) {
  return (
    <div className="history-panel">
      <div className="history-title">
        <History size={17} />
        <strong>历史记录</strong>
      </div>
      {history.length === 0 ? (
        <p className="empty-text">暂无保存记录。</p>
      ) : (
        history.map((record) => (
          <button className="history-item" type="button" key={record.id} onClick={() => loadRecord(record)}>
            <div>
              <strong>{record.institutionName}</strong>
              <span>{new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
            </div>
            <div>
              <b>{record.finalGrade}</b>
              <span>{record.maxTermDays} 天 / {formatMoney(record.suggestedLimit)}</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function SectionTitle({ icon: Icon, title }) {
  return (
    <div className="section-title">
      <Icon size={18} />
      <h2>{title}</h2>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange, min, prefix, suffix, helperText, tone = 'neutral' }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="input-affix">
        {prefix && <span>{prefix}</span>}
        <input
          inputMode="decimal"
          min={min}
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      {helperText && <small className={`field-helper ${tone}`}>{helperText}</small>}
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {Object.entries(options).map(([key, labelText]) => (
          <option key={key} value={key}>{labelText}</option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({ label, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function FieldAlert({ tone, text }) {
  return (
    <div className={`field-alert ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <AlertTriangle size={15} />
      <span>{text}</span>
    </div>
  );
}

function SwitchField({ label, checked, onChange, danger = false }) {
  return (
    <button
      className={`switch-row ${checked ? 'on' : ''} ${danger && checked ? 'danger' : ''}`}
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span>{label}</span>
      <i aria-hidden="true" />
    </button>
  );
}

function TagStrip({ items, tone = 'neutral' }) {
  return (
    <div className="tag-strip">
      {items.map((item) => (
        <span className={`risk-tag ${tone}`} key={item}>{item}</span>
      ))}
    </div>
  );
}

export default App;
