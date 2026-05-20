import { describe, expect, it } from 'vitest';
import { buildDisplayAssessmentResult } from './displayAssessmentResult';
import { DEFAULT_FORM, evaluateCredit } from './riskEngine';

const baseResult = evaluateCredit({
  ...DEFAULT_FORM,
  publicCreditStatus: 'normal'
});

describe('buildDisplayAssessmentResult', () => {
  it('keeps the formal evaluation result before verification evidence exists', () => {
    const display = buildDisplayAssessmentResult({
      result: baseResult,
      assessmentStage: { id: 'draft' },
      latestVerificationSummary: null,
      verificationReviews: []
    });

    expect(display.overlay).toBeNull();
    expect(display.result.finalDecision).toBe(baseResult.finalDecision);
    expect(display.result.finalGrade).toBe(baseResult.finalGrade);
  });

  it('temporarily covers the display as E when unconfirmed verification hits illegal medical practice', () => {
    const display = buildDisplayAssessmentResult({
      result: baseResult,
      assessmentStage: { id: 'review_pending' },
      latestVerificationSummary: {
        status: 'completed',
        riskLevel: 'high',
        suggestedPublicCreditStatus: 'medium',
        riskTags: ['非法行医', '行政处罚']
      },
      verificationReviews: []
    });

    expect(display.overlay).toMatchObject({
      level: 'redline',
      title: '疑似红线，暂停授信',
      statusLabel: '预警覆盖，未人工确认'
    });
    expect(display.result.finalGrade).toBe('E');
    expect(display.result.finalDecision).toBe('疑似红线，暂停授信');
    expect(display.result.maxTermDays).toBe(0);
    expect(display.result.suggestedLimit).toBe(0);
  });

  it('temporarily covers the display as high risk when unconfirmed verification hits administrative penalty', () => {
    const display = buildDisplayAssessmentResult({
      result: baseResult,
      assessmentStage: { id: 'review_pending' },
      latestVerificationSummary: {
        status: 'completed',
        riskLevel: 'medium',
        suggestedPublicCreditStatus: 'medium',
        riskTags: ['行政处罚']
      },
      verificationReviews: []
    });

    expect(display.overlay).toMatchObject({
      level: 'highRisk',
      title: '疑似高风险，待复核'
    });
    expect(display.result.finalGrade).toBe('D');
    expect(display.result.finalDecision).not.toBe('正常授信');
    expect(display.result.maxTermDays).toBeLessThanOrEqual(7);
  });

  it('removes temporary overlay after manual review exists', () => {
    const display = buildDisplayAssessmentResult({
      result: baseResult,
      assessmentStage: { id: 'final' },
      latestVerificationSummary: {
        status: 'completed',
        riskLevel: 'high',
        suggestedPublicCreditStatus: 'serious',
        riskTags: ['严重违法失信']
      },
      verificationReviews: [{ id: 'review-1', reviewerDecision: 'serious' }]
    });

    expect(display.overlay).toBeNull();
    expect(display.result.finalDecision).toBe(baseResult.finalDecision);
  });
});
