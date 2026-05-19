import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
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
  PAYMENT_LABELS,
  PUBLIC_CREDIT_LABELS,
  QUALIFICATION_LABELS,
  evaluateCredit
} from './riskEngine';
import { createLocalAssessmentRepository } from './assessmentRepository';

const tabs = [
  { id: 'basic', label: '基础', icon: FileText },
  { id: 'purchase', label: '采购', icon: TrendingUp },
  { id: 'payment', label: '履约', icon: ClipboardCheck },
  { id: 'verify', label: '核验', icon: Search },
  { id: 'result', label: '结果', icon: ShieldCheck }
];

const formatMoney = (value) => `¥${Math.round(Number(value) || 0).toLocaleString('zh-CN')}`;

function App() {
  const assessmentRepository = useMemo(() => createLocalAssessmentRepository(), []);
  const [activeTab, setActiveTab] = useState('basic');
  const [form, setForm] = useState(() => assessmentRepository.loadDraft());
  const [history, setHistory] = useState(() => assessmentRepository.listRecords());
  const [toast, setToast] = useState('');
  const result = useMemo(() => evaluateCredit(form), [form]);
  const activeStepIndex = tabs.findIndex((tab) => tab.id === activeTab);

  useEffect(() => {
    assessmentRepository.saveDraft(form);
  }, [assessmentRepository, form]);

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

  const saveRecord = () => {
    assessmentRepository.saveRecord({ form, result });
    setHistory(assessmentRepository.listRecords());
    setToast('已保存当前评估记录');
    setActiveTab('result');
  };

  const resetForm = () => {
    setForm(assessmentRepository.resetDraft());
    setToast('表单已重置为示例状态');
    setActiveTab('basic');
  };

  const loadRecord = (record) => {
    const storedRecord = assessmentRepository.loadRecord(record.id) || record;
    setForm(storedRecord.form);
    setToast('已载入历史记录');
    setActiveTab('result');
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

        <section className="content-panel">
          {activeTab === 'basic' && (
            <BasicStep form={form} updateField={updateField} result={result} />
          )}
          {activeTab === 'purchase' && (
            <PurchaseStep form={form} updateField={updateField} updatePurchase={updatePurchase} result={result} />
          )}
          {activeTab === 'payment' && (
            <PaymentStep form={form} updateField={updateField} />
          )}
          {activeTab === 'verify' && (
            <VerifyStep form={form} updateField={updateField} result={result} copyKeyword={copyKeyword} />
          )}
          {activeTab === 'result' && (
            <ResultStep result={result} history={history} loadRecord={loadRecord} />
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

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BasicStep({ form, updateField, result }) {
  const termOverLimit = result.requestedTerm > result.maxTermDays && result.finalGrade !== 'E';
  const limitOverAverage = result.requestedLimit > result.stableMonthlyAverage && result.finalGrade !== 'E';

  return (
    <div className="step-stack">
      <SectionTitle icon={FileText} title="机构基础信息" />
      <TextField label="机构名称" value={form.institutionName} onChange={(value) => updateField('institutionName', value)} />
      <TextField label="统一社会信用代码" value={form.creditCode} onChange={(value) => updateField('creditCode', value)} placeholder="可暂不填写" />
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

function VerifyStep({ form, updateField, result, copyKeyword }) {
  return (
    <div className="step-stack">
      <SectionTitle icon={Search} title="公共信用与核验" />
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

      <div className="verification-module">
        <div>
          <Database size={17} />
          <strong>联网核验预留</strong>
          <span>后续可接企业信用、执行信息、卫健委处罚接口</span>
        </div>
        <button type="button" onClick={() => updateField('publicCreditStatus', 'normal')}>
          标记已人工查询
        </button>
      </div>

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

function ResultStep({ result, history, loadRecord }) {
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

      <div className="next-actions">
        <strong>后续建议</strong>
        <p>{result.finalGrade === 'E' ? '先补齐准入红线问题，再重新评估。' : result.needsApproval ? '进入特批流程，并补充人工核验截图和业务说明。' : '可按系统建议账期与额度推进授信。'}</p>
      </div>

      <HistoryList history={history} loadRecord={loadRecord} />
    </div>
  );
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
