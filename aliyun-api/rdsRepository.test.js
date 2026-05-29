import { describe, expect, it } from 'vitest';
import { createRdsAssessmentRepository } from './rdsRepository.js';

class FakePool {
  constructor(rows = []) {
    this.rowsQueue = [...rows];
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ text: normalizeSql(text), values });
    const rows = this.rowsQueue.length ? this.rowsQueue.shift() : [];
    return { rows, rowCount: rows.length };
  }
}

describe('createRdsAssessmentRepository', () => {
  it('saves and loads drafts through parameterized SQL', async () => {
    const pool = new FakePool([[{ form_snapshot: { institutionName: '杭州星澜' } }], []]);
    const repository = createRdsAssessmentRepository({ pool });

    expect(await repository.loadDraft('client-1')).toEqual({ form: { institutionName: '杭州星澜' } });
    expect(await repository.saveDraft('client-1', { institutionName: '上海清澜' })).toEqual({ form: { institutionName: '上海清澜' } });

    expect(pool.calls[0].text).toContain('select form_snapshot from assessment_drafts');
    expect(pool.calls[0].values).toEqual(['client-1']);
    expect(pool.calls[1].text).toContain('on conflict (client_instance_id) do update');
    expect(pool.calls[1].values).toEqual(['client-1', JSON.stringify({ institutionName: '上海清澜' })]);
  });

  it('persists assessment records without recalculating risk rules', async () => {
    const recordRow = {
      id: 'record-1',
      client_instance_id: 'client-1',
      institution_name: '上海风险机构',
      final_grade: 'E',
      final_decision: '不建议授信',
      total_score: 12,
      max_term_days: 0,
      suggested_limit: 0,
      stable_monthly_average: 30000,
      needs_approval: false,
      redline_reasons: ['命中严重违法失信'],
      cap_reasons: [],
      approval_reasons: [],
      form_snapshot: { institutionName: '上海风险机构', publicCreditStatus: 'serious' },
      result_snapshot: { finalGrade: 'E', finalDecision: '不建议授信' },
      created_at: '2026-05-30T00:00:00.000Z',
      updated_at: '2026-05-30T00:00:00.000Z'
    };
    const pool = new FakePool([[recordRow]]);
    const repository = createRdsAssessmentRepository({
      pool,
      now: () => new Date('2026-05-30T00:00:00.000Z'),
      id: () => 'record-1'
    });

    const response = await repository.saveRecord('client-1', {
      form: recordRow.form_snapshot,
      result: {
        finalGrade: 'E',
        finalDecision: '不建议授信',
        totalScore: 12,
        maxTermDays: 0,
        suggestedLimit: 0,
        stableMonthlyAverage: 30000,
        needsApproval: false,
        redlineReasons: ['命中严重违法失信'],
        capReasons: [],
        approvalReasons: []
      },
      record: { id: 'record-1' }
    });

    expect(response.record).toMatchObject({
      id: 'record-1',
      institutionName: '上海风险机构',
      finalGrade: 'E',
      finalDecision: '不建议授信',
      redlineReasons: ['命中严重违法失信']
    });
    expect(pool.calls[0].text).toContain('insert into assessment_records');
    expect(pool.calls[0].values[10]).toBe(JSON.stringify(['命中严重违法失信']));
  });

  it('stores verification logs and keeps raw result payloads intact', async () => {
    const pool = new FakePool([[
      {
        id: '11111111-1111-4111-8111-111111111111',
        assessment_record_id: 'record-1',
        client_instance_id: 'client-1',
        provider: 'zhipu_web_search',
        status: 'completed',
        query_keywords: ['机构 行政处罚'],
        raw_results: [{ keyword: '机构 行政处罚', result: { title: '处罚公告' } }],
        extracted_flags: { verificationSummary: { judgmentLabel: '疑似风险' } },
        risk_tags: ['行政处罚'],
        created_at: '2026-05-30T00:00:00.000Z',
        updated_at: '2026-05-30T00:00:00.000Z'
      }
    ]]);
    const repository = createRdsAssessmentRepository({
      pool,
      now: () => new Date('2026-05-30T00:00:00.000Z')
    });

    const response = await repository.saveVerificationLog('client-1', {
      recordId: 'record-1',
      status: 'completed',
      queryKeywords: ['机构 行政处罚'],
      rawResults: [{ keyword: '机构 行政处罚', result: { title: '处罚公告' } }],
      extractedFlags: { verificationSummary: { judgmentLabel: '疑似风险' } },
      riskTags: ['行政处罚'],
      startedAt: '2026-05-30T00:00:00.000Z'
    });

    expect(response.verificationLog).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      rawResultCount: 1,
      riskTags: ['行政处罚']
    });
    expect(pool.calls[0].text).toContain('insert into verification_logs');
    expect(pool.calls[0].values[5]).toBe(JSON.stringify([{ keyword: '机构 行政处罚', result: { title: '处罚公告' } }]));
  });

  it('saves verification review logs with evidence attachments', async () => {
    const pool = new FakePool([[
      {
        id: 'review-1',
        assessment_record_id: 'record-1',
        verification_log_id: '11111111-1111-4111-8111-111111111111',
        client_instance_id: 'client-1',
        action: 'accept_suggestion',
        reviewer_name: '复核人 A',
        reviewer_decision: 'serious',
        previous_public_credit_status: 'unknown',
        suggested_public_credit_status: 'serious',
        evidence_url: '',
        evidence_note: '采用系统建议',
        verification_snapshot: {},
        applied_fields: { publicCreditStatus: 'serious' },
        evidence_attachments: [
          {
            id: 'attachment-1',
            bucket: 'medical-credit-verification-evidence',
            path: 'client-1/record-1/20260530/attachment-1.png',
            fileName: '截图.png',
            mimeType: 'image/png',
            size: 100,
            uploadedAt: '2026-05-30T00:00:00.000Z'
          }
        ],
        created_at: '2026-05-30T00:00:00.000Z'
      }
    ]]);
    const repository = createRdsAssessmentRepository({
      pool,
      signEvidenceAttachments: async (attachments) => attachments.map((item) => ({ ...item, signedUrl: `https://oss.example.com/${item.path}` }))
    });

    const response = await repository.saveVerificationReview('client-1', 'record-1', {
      action: 'accept_suggestion',
      reviewerName: '复核人 A',
      reviewerDecision: 'serious',
      verificationLogId: '11111111-1111-4111-8111-111111111111',
      previousPublicCreditStatus: 'unknown',
      suggestedPublicCreditStatus: 'serious',
      evidenceNote: '采用系统建议',
      appliedFields: { publicCreditStatus: 'serious' },
      evidenceAttachments: [
        {
          id: 'attachment-1',
          bucket: 'medical-credit-verification-evidence',
          path: 'client-1/record-1/20260530/attachment-1.png',
          fileName: '截图.png',
          mimeType: 'image/png',
          size: 100,
          uploadedAt: '2026-05-30T00:00:00.000Z'
        }
      ]
    });

    expect(response.verificationReview).toMatchObject({
      id: 'review-1',
      reviewerName: '复核人 A',
      reviewerDecision: 'serious',
      evidenceAttachments: [
        expect.objectContaining({
          id: 'attachment-1',
          signedUrl: 'https://oss.example.com/client-1/record-1/20260530/attachment-1.png'
        })
      ]
    });
    expect(pool.calls[0].text).toContain('insert into verification_reviews');
    expect(pool.calls[0].values[12]).toContain('attachment-1');
  });
});

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}
