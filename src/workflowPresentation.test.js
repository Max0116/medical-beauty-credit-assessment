import { describe, expect, it } from 'vitest';
import {
  buildCommandCenterModel,
  buildWorkflowSteps,
  getVerificationProgress,
  getVerificationStatusLabel
} from './workflowPresentation';
import { DEFAULT_FORM, evaluateCredit } from './riskEngine';

describe('workflow presentation', () => {
  it('does not show formal scoring before an institution name exists', () => {
    const form = { ...DEFAULT_FORM, institutionName: '' };
    const result = evaluateCredit(form);
    const model = buildCommandCenterModel({
      form,
      result,
      displayResult: result,
      assessmentStage: { id: 'draft', tone: 'draft' },
      activeRecordId: '',
      verificationLogStatus: 'idle',
      latestVerificationSummary: null,
      verificationReviews: [],
      activeTab: 'institution'
    });

    expect(model.decisionLabel).toBe('待录入机构');
    expect(model.gradeLabel).toBe('未生成');
    expect(model.showFormalResult).toBe(false);
  });

  it('keeps verification active while the user fills assessment fields', () => {
    const form = { ...DEFAULT_FORM, institutionName: '杭州星澜医疗美容诊所' };
    const steps = buildWorkflowSteps({
      form,
      activeRecordId: 'record-1',
      summary: { status: 'running', phase: 'searching_full' },
      reviews: [],
      activeTab: 'assessment'
    });

    expect(steps.find((step) => step.id === 'verify').state).toBe('active');
    expect(steps.find((step) => step.id === 'assessment').state).toBe('active');
  });

  it('uses keyword progress and phase labels when available', () => {
    const summary = {
      status: 'running',
      phase: 'searching_full',
      completedKeywords: 3,
      totalKeywords: 7
    };

    expect(getVerificationStatusLabel({
      activeRecordId: 'record-1',
      status: 'ready',
      summary
    })).toBe('补全风险线索中');
    expect(getVerificationProgress({
      activeRecordId: 'record-1',
      status: 'ready',
      summary
    })).toBeGreaterThan(30);
  });
});
