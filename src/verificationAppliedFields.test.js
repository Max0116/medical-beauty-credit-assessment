import { describe, expect, it } from 'vitest';
import {
  buildVerificationAppliedFields,
  getAssessmentStage,
  getVerificationClosureStatus
} from './verificationAppliedFields';

describe('buildVerificationAppliedFields', () => {
  it('maps accepted dishonesty and serious-illegal evidence into redline fields', () => {
    const fields = buildVerificationAppliedFields({
      reviewerDecision: 'serious',
      currentForm: {
        publicCreditStatus: 'unknown',
        dishonestyHit: false,
        seriousIllegalHit: false,
        majorMedicalPenalty: false,
        outOfScopeOperation: false
      },
      latestLog: {
        extractedFlags: {
          dishonestyHit: true,
          seriousIllegalHit: true
        }
      },
      summary: {
        suggestedPublicCreditStatus: 'serious',
        riskTags: ['失信被执行人', '严重违法失信']
      }
    });

    expect(fields).toEqual({
      publicCreditStatus: 'serious',
      dishonestyHit: true,
      seriousIllegalHit: true
    });
  });

  it('maps medical penalty and out-of-scope clues into their risk fields', () => {
    const fields = buildVerificationAppliedFields({
      reviewerDecision: 'medium',
      currentForm: {
        publicCreditStatus: 'unknown',
        majorMedicalPenalty: false,
        outOfScopeOperation: false
      },
      latestLog: { extractedFlags: {} },
      summary: {
        suggestedPublicCreditStatus: 'medium',
        riskTags: ['行政处罚', '非法行医']
      }
    });

    expect(fields).toEqual({
      publicCreditStatus: 'medium',
      majorMedicalPenalty: true,
      outOfScopeOperation: true
    });
  });

  it('does not rewrite fields already applied to the form', () => {
    const fields = buildVerificationAppliedFields({
      reviewerDecision: 'serious',
      currentForm: {
        publicCreditStatus: 'serious',
        dishonestyHit: true,
        seriousIllegalHit: true
      },
      latestLog: { extractedFlags: { dishonestyHit: true, seriousIllegalHit: true } },
      summary: {
        suggestedPublicCreditStatus: 'serious',
        riskTags: ['失信被执行人', '严重违法失信']
      }
    });

    expect(fields).toEqual({});
  });

  it('keeps mark-reviewed actions as audit-only entries', () => {
    const fields = buildVerificationAppliedFields({
      action: 'mark_reviewed',
      reviewerDecision: 'serious',
      currentForm: {
        publicCreditStatus: 'unknown',
        dishonestyHit: false,
        seriousIllegalHit: false
      },
      latestLog: { extractedFlags: { dishonestyHit: true, seriousIllegalHit: true } },
      summary: {
        suggestedPublicCreditStatus: 'serious',
        riskTags: ['失信被执行人', '严重违法失信']
      }
    });

    expect(fields).toEqual({});
  });
});

describe('getVerificationClosureStatus', () => {
  it('describes verification and review closure states', () => {
    expect(getVerificationClosureStatus({ activeRecordId: '', summary: null, reviews: [] })).toBe('未保存');
    expect(getVerificationClosureStatus({ activeRecordId: 'record-1', summary: null, reviews: [] })).toBe('待核验');
    expect(getVerificationClosureStatus({ activeRecordId: 'record-1', summary: { status: 'pending' }, reviews: [] })).toBe('核验中');
    expect(getVerificationClosureStatus({ activeRecordId: 'record-1', summary: { status: 'completed' }, reviews: [] })).toBe('待人工确认');
    expect(getVerificationClosureStatus({ activeRecordId: 'record-1', summary: { status: 'completed' }, reviews: [{ id: 'review-1' }] })).toBe('已人工确认');
  });
});

describe('getAssessmentStage', () => {
  it('marks unsaved records as draft pre-assessments', () => {
    expect(getAssessmentStage({
      activeRecordId: '',
      isRemoteMode: true,
      summary: null,
      reviews: []
    })).toMatchObject({
      id: 'draft',
      title: '草稿预评估',
      decisionScope: '当前结论仅基于已填字段',
      verificationLabel: '未发起核验',
      reviewLabel: '未人工确认',
      actionTarget: 'basic'
    });
  });

  it('keeps completed verification without review in a review-pending state', () => {
    expect(getAssessmentStage({
      activeRecordId: 'record-1',
      isRemoteMode: true,
      summary: { status: 'completed', riskLevel: 'medium' },
      reviews: []
    })).toMatchObject({
      id: 'review_pending',
      title: '待人工确认',
      decisionScope: '当前结论仍是预评估',
      verificationLabel: '已完成核验',
      reviewLabel: '未人工确认',
      actionTarget: 'verify'
    });
  });

  it('elevates confirmed reviews to final assessment state', () => {
    expect(getAssessmentStage({
      activeRecordId: 'record-1',
      isRemoteMode: true,
      summary: { status: 'completed', riskLevel: 'high' },
      reviews: [{ id: 'review-1' }]
    })).toMatchObject({
      id: 'final',
      title: '最终评估',
      decisionScope: '当前结论已完成复核闭环',
      verificationLabel: '已完成核验',
      reviewLabel: '已确认 1 条',
      actionTarget: 'result'
    });
  });

  it('marks failed verification as not final', () => {
    expect(getAssessmentStage({
      activeRecordId: 'record-1',
      isRemoteMode: true,
      summary: { status: 'failed' },
      reviews: []
    })).toMatchObject({
      id: 'verification_failed',
      title: '核验异常',
      decisionScope: '当前结论仍是预评估',
      verificationLabel: '核验失败'
    });
  });
});
