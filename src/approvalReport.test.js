import { describe, expect, it } from 'vitest';
import { buildApprovalReportData, buildApprovalReportText, formatReportDateTime } from './approvalReport';
import { DEFAULT_FORM, evaluateCredit } from './riskEngine';

const makeResult = () => evaluateCredit({
  ...DEFAULT_FORM,
  institutionName: '杭州星澜医疗美容诊所',
  creditCode: '91330100TEST000001',
  publicCreditStatus: 'serious',
  seriousIllegalHit: true,
  requestedTerm: 30,
  requestedLimit: 120000
});

const summary = {
  status: 'completed',
  judgmentLabel: '疑似严重风险',
  conclusion: '公开信息中发现严重违法失信相关线索，需要人工复核后停止常规授信。',
  riskTags: ['严重违法失信', '被执行人'],
  evidenceInsight: {
    overview: 'AI 摘要显示该机构存在需重点复核的公共信用风险。'
  },
  evidenceSummaries: [
    {
      category: '严重违法失信',
      title: '杭州星澜医疗美容诊所严重违法失信信息',
      source: '公开网页',
      sourceHost: 'example.gov.cn',
      publishDate: '2026-05-18',
      url: 'https://example.gov.cn/risk'
    }
  ]
};

describe('approval report', () => {
  it('builds a formal approval report with institution, decision, risk reasons, evidence, and reviewer trace', () => {
    const report = buildApprovalReportData({
      form: {
        ...DEFAULT_FORM,
        institutionName: '杭州星澜医疗美容诊所',
        creditCode: '91330100TEST000001',
        businessStage: 'over6Months'
      },
      result: makeResult(),
      assessmentStage: {
        id: 'final',
        title: '最终评估',
        decisionScope: '当前结论已完成复核闭环'
      },
      latestVerificationSummary: summary,
      verificationReviews: [
        {
          action: 'accept_suggestion',
          reviewerName: '王经理',
          reviewerDecision: 'serious',
          createdAt: '2026-05-20T02:30:00.000Z',
          evidenceUrl: 'https://example.gov.cn/risk',
          evidenceNote: '采用系统建议，证据截图已归档。',
          evidenceAttachments: [
            { fileName: '风险截图.png', signedUrl: 'https://storage.example/signed' }
          ]
        }
      ],
      generatedAt: '2026-05-20T03:00:00.000Z'
    });

    expect(report.institution.name).toBe('杭州星澜医疗美容诊所');
    expect(report.institution.stage).toBe('合作 ≥ 6 个月');
    expect(report.decision.finalGrade).toBe('E');
    expect(report.decision.finalDecision).toBe('不建议授信');
    expect(report.verification.reviewStatus).toBe('已人工确认');
    expect(report.verification.reviewerName).toBe('王经理');
    expect(report.verification.reviewerDecision).toBe('失信 / 严重违法');
    expect(report.riskReasons).toContain('命中严重违法失信');
    expect(report.evidenceItems[0].url).toBe('https://example.gov.cn/risk');
    expect(report.verification.evidenceAttachments[0].fileName).toBe('风险截图.png');
  });

  it('exports readable approval text for boss or approval circulation', () => {
    const report = buildApprovalReportData({
      form: {
        ...DEFAULT_FORM,
        institutionName: '杭州星澜医疗美容诊所',
        creditCode: '91330100TEST000001'
      },
      result: makeResult(),
      assessmentStage: { id: 'final', title: '最终评估' },
      latestVerificationSummary: summary,
      verificationReviews: [{ reviewerName: '王经理', reviewerDecision: 'serious', createdAt: '2026-05-20T02:30:00.000Z' }],
      generatedAt: '2026-05-20T03:00:00.000Z'
    });

    const text = buildApprovalReportText(report);

    expect(text).toContain('医美机构账期授信审批摘要');
    expect(text).toContain('机构：杭州星澜医疗美容诊所');
    expect(text).toContain('最终等级：E');
    expect(text).toContain('核验状态：疑似严重风险');
    expect(text).toContain('复核人：王经理');
    expect(text).toContain('证据来源：');
  });

  it('keeps invalid report dates explicit instead of showing browser invalid date text', () => {
    expect(formatReportDateTime('not-a-date')).toBe('未记录');
    expect(formatReportDateTime('', '暂无')).toBe('暂无');
  });
});
