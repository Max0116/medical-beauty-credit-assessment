import { describe, expect, it } from 'vitest';
import { createMysqlAssessmentRepository } from './mysqlRepository.js';

class FakeMysqlPool {
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

describe('createMysqlAssessmentRepository', () => {
  it('saves drafts with MySQL JSON upsert syntax', async () => {
    const pool = new FakeMysqlPool([[]]);
    const repository = createMysqlAssessmentRepository({ pool });

    await expect(repository.saveDraft('client-1', { institutionName: '上海星澜' })).resolves.toEqual({
      form: { institutionName: '上海星澜' }
    });

    expect(pool.calls[0].text).toContain('on duplicate key update');
    expect(pool.calls[0].text).not.toContain('cast(? as json)');
    expect(pool.calls[0].values).toEqual(['client-1', JSON.stringify({ institutionName: '上海星澜' })]);
  });

  it('persists records without recalculating submitted risk results', async () => {
    const recordRow = {
      id: 'record-1',
      client_instance_id: 'client-1',
      institution_name: '上海风险机构',
      final_grade: 'E',
      final_decision: '不建议授信',
      total_score: 0,
      max_term_days: 0,
      suggested_limit: '0.00',
      stable_monthly_average: '30000.00',
      needs_approval: 0,
      redline_reasons: JSON.stringify(['命中严重违法失信']),
      cap_reasons: JSON.stringify([]),
      approval_reasons: JSON.stringify([]),
      form_snapshot: JSON.stringify({ institutionName: '上海风险机构', publicCreditStatus: 'serious' }),
      result_snapshot: JSON.stringify({ finalGrade: 'E', finalDecision: '不建议授信' }),
      created_at: '2026-05-30T00:00:00.000Z',
      updated_at: '2026-05-30T00:00:00.000Z'
    };
    const pool = new FakeMysqlPool([[], [recordRow]]);
    const repository = createMysqlAssessmentRepository({
      pool,
      now: () => new Date('2026-05-30T00:00:00.000Z'),
      id: () => 'record-1'
    });

    const response = await repository.saveRecord('client-1', {
      form: { institutionName: '上海风险机构', publicCreditStatus: 'serious' },
      result: {
        finalGrade: 'E',
        finalDecision: '不建议授信',
        totalScore: 0,
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
    expect(pool.calls[0].text).toContain('on duplicate key update');
    expect(pool.calls[1].text).toContain('select * from assessment_records');
  });

  it('stores verification logs and maps JSON string fields back to UI payloads', async () => {
    const logRow = {
      id: '11111111-1111-4111-8111-111111111111',
      assessment_record_id: 'record-1',
      client_instance_id: 'client-1',
      provider: 'zhipu_web_search',
      status: 'completed',
      query_keywords: JSON.stringify(['机构 行政处罚']),
      raw_results: JSON.stringify([{ keyword: '机构 行政处罚', result: { title: '处罚公告' } }]),
      extracted_flags: JSON.stringify({ verificationSummary: { judgmentLabel: '疑似风险' } }),
      risk_tags: JSON.stringify(['行政处罚']),
      created_at: '2026-05-30T00:00:00.000Z',
      updated_at: '2026-05-30T00:00:00.000Z'
    };
    const pool = new FakeMysqlPool([[], [logRow]]);
    const repository = createMysqlAssessmentRepository({
      pool,
      now: () => new Date('2026-05-30T00:00:00.000Z'),
      id: () => '11111111-1111-4111-8111-111111111111'
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
    expect(pool.calls[0].values[6]).toBe(JSON.stringify([{ keyword: '机构 行政处罚', result: { title: '处罚公告' } }]));
  });

  it('saves verification reviews with evidence attachments', async () => {
    const reviewRow = {
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
      verification_snapshot: JSON.stringify({}),
      applied_fields: JSON.stringify({ publicCreditStatus: 'serious' }),
      evidence_attachments: JSON.stringify([
        {
          id: 'attachment-1',
          bucket: 'medical-credit-verification-evidence',
          path: 'verification-evidence/client-1/record-1/20260530/attachment-1.png',
          fileName: '截图.png',
          mimeType: 'image/png',
          size: 100,
          uploadedAt: '2026-05-30T00:00:00.000Z'
        }
      ]),
      created_at: '2026-05-30T00:00:00.000Z'
    };
    const pool = new FakeMysqlPool([[], [reviewRow]]);
    const repository = createMysqlAssessmentRepository({
      pool,
      id: () => 'review-1',
      signEvidenceAttachments: async (attachments) => attachments.map((item) => ({ ...item, signedUrl: `https://oss.example.com/${item.path}` }))
    });

    const response = await repository.saveVerificationReview('client-1', 'record-1', {
      action: 'accept_suggestion',
      reviewerName: '复核人 A',
      reviewerDecision: 'serious',
      verificationLogId: '11111111-1111-4111-8111-111111111111',
      evidenceAttachments: [
        {
          id: 'attachment-1',
          bucket: 'medical-credit-verification-evidence',
          path: 'verification-evidence/client-1/record-1/20260530/attachment-1.png',
          fileName: '截图.png',
          mimeType: 'image/png',
          size: 100,
          uploadedAt: '2026-05-30T00:00:00.000Z'
        }
      ],
      appliedFields: { publicCreditStatus: 'serious' }
    });

    expect(response.verificationReview).toMatchObject({
      id: 'review-1',
      reviewerName: '复核人 A',
      evidenceAttachments: [
        expect.objectContaining({
          id: 'attachment-1',
          signedUrl: 'https://oss.example.com/verification-evidence/client-1/record-1/20260530/attachment-1.png'
        })
      ]
    });
    expect(pool.calls[0].text).toContain('insert into verification_reviews');
    expect(pool.calls[0].values[13]).toContain('attachment-1');
  });
});

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}
