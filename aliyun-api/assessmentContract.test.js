import { describe, expect, it } from 'vitest';
import {
  buildVerificationKeywords,
  mapRecordRow,
  mapVerificationLogRow,
  normalizeEvidenceAttachments,
  normalizeIncomingRecord,
  normalizeIncomingVerificationReview,
  sanitizeFileName,
  sanitizeStorageSegment,
  toRecordRow,
  toVerificationReviewRow
} from './assessmentContract.js';

describe('assessment API contract helpers', () => {
  it('normalizes incoming records without changing risk result fields', () => {
    const form = { institutionName: '上海清澜医疗美容诊所' };
    const result = {
      finalGrade: 'C',
      finalDecision: '谨慎短账期，需特批',
      totalScore: 66,
      maxTermDays: 15,
      suggestedLimit: 24000,
      stableMonthlyAverage: 60000,
      needsApproval: true,
      redlineReasons: [],
      capReasons: ['公共信用未查询 / 无法确认，最高 C'],
      approvalReasons: ['公共信用未查询或无法确认']
    };

    const record = normalizeIncomingRecord({}, form, result, () => new Date('2026-05-30T00:00:00.000Z'), () => 'record-1');

    expect(record).toMatchObject({
      id: 'record-1',
      institutionName: '上海清澜医疗美容诊所',
      finalGrade: 'C',
      finalDecision: '谨慎短账期，需特批',
      totalScore: 66,
      maxTermDays: 15,
      suggestedLimit: 24000,
      stableMonthlyAverage: 60000,
      needsApproval: true,
      createdAt: '2026-05-30T00:00:00.000Z',
      updatedAt: '2026-05-30T00:00:00.000Z',
      form,
      result
    });
  });

  it('maps record rows between camelCase API payloads and snake_case RDS rows', () => {
    const record = normalizeIncomingRecord(
      { id: 'record-1' },
      { institutionName: '杭州星澜医疗美容诊所' },
      { finalGrade: 'A', finalDecision: '正常授信', totalScore: 86 },
      () => new Date('2026-05-30T00:00:00.000Z')
    );

    const row = toRecordRow(record, 'client-1');
    expect(row).toMatchObject({
      id: 'record-1',
      client_instance_id: 'client-1',
      institution_name: '杭州星澜医疗美容诊所',
      final_grade: 'A',
      final_decision: '正常授信'
    });
    expect(mapRecordRow(row)).toMatchObject({
      id: 'record-1',
      institutionName: '杭州星澜医疗美容诊所',
      finalGrade: 'A',
      finalDecision: '正常授信'
    });
  });

  it('normalizes verification evidence and review payloads with strict review decisions', () => {
    const review = normalizeIncomingVerificationReview({
      action: 'accept_suggestion',
      reviewerName: '复核人 A',
      reviewerDecision: 'serious',
      verificationLogId: '11111111-1111-4111-8111-111111111111',
      evidenceAttachments: [
        {
          id: 'attachment-1',
          bucket: 'medical-credit-verification-evidence',
          path: 'client-1/record-1/attachment-1.png',
          fileName: '截图.png',
          mimeType: 'image/png',
          size: 1024,
          uploadedAt: '2026-05-30T00:00:00.000Z'
        },
        {
          id: 'attachment-2',
          bucket: 'medical-credit-verification-evidence',
          path: 'verification-evidence/client-1/record-1/20260530/attachment-2.png',
          fileName: '阿里云截图.png',
          mimeType: 'image/png',
          size: 2048,
          uploadedAt: '2026-05-30T00:00:00.000Z'
        },
        {
          id: 'bad',
          bucket: 'medical-credit-verification-evidence',
          path: 'other-client/record-1/bad.png',
          fileName: '越权.png'
        }
      ],
      appliedFields: { publicCreditStatus: 'serious' }
    }, 'record-1', 'client-1');

    expect(review.evidenceAttachments).toHaveLength(2);
    expect(review.evidenceAttachments[0].fileName).toBe('截图.png');
    expect(review.evidenceAttachments[1].fileName).toBe('阿里云截图.png');
    expect(toVerificationReviewRow(review, 'client-1')).toMatchObject({
      assessment_record_id: 'record-1',
      verification_log_id: '11111111-1111-4111-8111-111111111111',
      client_instance_id: 'client-1',
      reviewer_decision: 'serious',
      applied_fields: { publicCreditStatus: 'serious' }
    });
    expect(() => normalizeIncomingVerificationReview({
      action: 'accept_suggestion',
      reviewerName: '复核人 A',
      reviewerDecision: 'bad'
    }, 'record-1', 'client-1')).toThrow('Invalid reviewerDecision.');
  });

  it('maps verification logs with transparent raw result counts', () => {
    expect(mapVerificationLogRow({
      id: 'log-1',
      assessment_record_id: 'record-1',
      provider: 'zhipu_web_search',
      status: 'completed',
      query_keywords: ['机构 行政处罚'],
      raw_results: [{ title: '处罚公告' }, { title: '另一条' }],
      risk_tags: ['行政处罚'],
      extracted_flags: { verificationSummary: { judgmentLabel: '疑似风险' } },
      created_at: '2026-05-30T00:00:00.000Z',
      updated_at: '2026-05-30T00:00:00.000Z'
    })).toMatchObject({
      id: 'log-1',
      recordId: 'record-1',
      queryKeywords: ['机构 行政处罚'],
      riskTags: ['行政处罚'],
      rawResultCount: 2,
      verificationSummary: { judgmentLabel: '疑似风险' }
    });
  });

  it('keeps storage path sanitization deterministic', () => {
    expect(sanitizeFileName('处罚 截图(1).png')).toBe('处罚_截图_1_.png');
    expect(sanitizeStorageSegment('client/../1')).toBe('client_.._1');
    expect(buildVerificationKeywords('上海星澜')).toEqual([
      '上海星澜 行政处罚',
      '上海星澜 被执行人',
      '上海星澜 失信被执行人',
      '上海星澜 医疗美容处罚',
      '上海星澜 非法行医',
      '上海星澜 经营异常',
      '上海星澜 严重违法失信'
    ]);
    expect(normalizeEvidenceAttachments([], 'client-1', 'record-1')).toEqual([]);
  });
});
