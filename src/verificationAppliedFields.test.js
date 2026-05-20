import { describe, expect, it } from 'vitest';
import { buildVerificationAppliedFields, getVerificationClosureStatus } from './verificationAppliedFields';

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
