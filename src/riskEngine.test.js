import { describe, expect, it } from 'vitest';
import { DEFAULT_FORM, evaluateCredit } from './riskEngine';

const makeForm = (overrides = {}) => ({
  ...DEFAULT_FORM,
  institutionName: '杭州星澜医疗美容诊所',
  businessStage: 'over6Months',
  hasPaidOrders: true,
  paidOrderCount: 8,
  requestedTerm: 21,
  requestedLimit: 30000,
  licenseValid: true,
  medicalLicenseValid: true,
  beautyScopeIncluded: true,
  subjectConsistent: true,
  qualificationStatus: 'complete',
  monthlyPurchases: [60000, 58000, 61000, 59000, 62000, 60000],
  longestGapDays: 20,
  abnormalLargeOrder: false,
  hasCurrentOverdue: false,
  currentOverdueAmount: 0,
  overTermCount6m: 0,
  maxOverTermDays: 0,
  historicalOverdue: 'none',
  reconciliationDispute: false,
  publicCreditStatus: 'normal',
  dishonestyHit: false,
  seriousIllegalHit: false,
  majorMedicalPenalty: false,
  ...overrides
});

describe('evaluateCredit', () => {
  it('treats a fresh assessment as unverified until public credit is confirmed', () => {
    const result = evaluateCredit(DEFAULT_FORM);

    expect(DEFAULT_FORM.publicCreditStatus).toBe('unknown');
    expect(result.finalGrade).toBe('C');
    expect(result.capReasons).toContain('公共信用未查询 / 无法确认，最高 C');
  });

  it('returns E and rejects credit when current overdue exists', () => {
    const result = evaluateCredit(makeForm({ hasCurrentOverdue: true }));

    expect(result.finalGrade).toBe('E');
    expect(result.finalDecision).toBe('不建议授信');
    expect(result.maxTermDays).toBe(0);
    expect(result.suggestedLimit).toBe(0);
    expect(result.redlineReasons).toContain('当前存在逾期未结清');
  });

  it('caps final grade at C when public credit is unverified', () => {
    const result = evaluateCredit(makeForm({ publicCreditStatus: 'unknown' }));

    expect(['C', 'D', 'E']).toContain(result.finalGrade);
    expect(result.capReasons).toContain('公共信用未查询 / 无法确认，最高 C');
  });

  it('caps final grade at B when historical overdue is 4-7 days', () => {
    const result = evaluateCredit(makeForm({ historicalOverdue: 'fourToSeven' }));

    expect(['B', 'C', 'D', 'E']).toContain(result.finalGrade);
    expect(result.finalGrade).toBe('B');
    expect(result.capReasons).toContain('4-7 天超账期，最高 B');
  });

  it('marks approval required when requested term exceeds grade max term', () => {
    const result = evaluateCredit(makeForm({ requestedTerm: 60 }));

    expect(result.needsApproval).toBe(true);
    expect(result.approvalReasons).toContain('申请账期超过等级最长账期');
  });

  it('marks approval required when requested limit exceeds stable monthly average', () => {
    const result = evaluateCredit(makeForm({ requestedLimit: 500000 }));

    expect(result.needsApproval).toBe(true);
    expect(result.approvalReasons).toContain('申请额度超过稳定月均销量');
  });

  it('recalculates stable monthly average and suggested limit from purchases', () => {
    const result = evaluateCredit(makeForm({
      monthlyPurchases: [12000, 18000, 0, 24000, 30000, 36000]
    }));

    expect(result.stableMonthlyAverage).toBe(20000);
    expect(result.purchaseMonths).toBe(5);
    expect(result.suggestedLimit).toBeGreaterThan(0);
  });
});
