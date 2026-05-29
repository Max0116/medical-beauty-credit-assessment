import { describe, expect, it } from 'vitest';
import {
  buildRawResultItems,
  buildVerificationSummary,
  extractVerificationEvidence
} from './verificationEvidence.js';

describe('Node verification evidence helpers', () => {
  it('keeps raw result relevance explanations available for UI review', () => {
    const rawResults = [
      {
        keyword: '上海愉悦美联臣医疗美容医院 行政处罚',
        result: {
          title: '上海愉悦美联臣医疗美容医院行政处罚公示',
          content: '上海愉悦美联臣医疗美容医院 因医疗广告违法受到行政处罚。',
          media: '监管公示网',
          link: 'https://example.com/penalty',
          publish_date: '2026-05-01'
        }
      },
      {
        keyword: '上海愉悦美联臣医疗美容医院 经营异常',
        result: {
          title: '其他机构经营异常',
          content: '其他机构 被列入经营异常。',
          media: '网页',
          link: 'https://example.com/other'
        }
      }
    ];

    const evidence = extractVerificationEvidence('上海愉悦美联臣医疗美容医院', rawResults);
    const rawItems = buildRawResultItems('上海愉悦美联臣医疗美容医院', rawResults);

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: '行政处罚',
        title: '上海愉悦美联臣医疗美容医院行政处罚公示',
        sourceHost: 'example.com'
      })
    ]));
    expect(rawItems).toEqual([
      expect.objectContaining({
        isRelevant: true,
        relevanceStatus: 'relevant'
      }),
      expect.objectContaining({
        isRelevant: false,
        relevanceStatus: 'risk_without_subject'
      })
    ]);
  });

  it('summarizes completed clear search as queried but no risk evidence', () => {
    const summary = buildVerificationSummary({
      status: 'completed',
      institutionName: '上海星澜医疗美容诊所',
      rawResults: [
        {
          keyword: '上海星澜医疗美容诊所 行政处罚',
          result: {
            title: '上海星澜医疗美容诊所 官网',
            content: '机构介绍',
            media: '网页',
            link: 'https://example.com/profile'
          }
        }
      ],
      riskTags: [],
      evidence: []
    });

    expect(summary.verificationSummary).toMatchObject({
      judgmentLabel: '未发现明显风险',
      suggestedPublicCreditStatus: 'normal',
      sourceCount: 1,
      matchedSourceCount: 0
    });
    expect(summary.verificationSummary.evidenceInsight.overview).toContain('已查询 1 条公开搜索结果');
  });
});
