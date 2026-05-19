import { describe, expect, it } from 'vitest';
import { buildVerificationSummary, extractBusinessProfile, extractVerificationEvidence } from './verificationEvidence.ts';

describe('verification evidence extraction', () => {
  it('does not treat risk words in query keywords as evidence', () => {
    const rawResults = [
      {
        keyword: '杭州星澜医疗美容诊所 失信被执行人',
        result: {
          title: '失信被执行人名单查询服务说明',
          content: '本文介绍公开查询方式，没有出现目标机构名称。',
          media: '测试来源',
          link: 'https://example.com/clear'
        }
      }
    ];

    const evidence = extractVerificationEvidence('杭州星澜医疗美容诊所', rawResults);
    const summary = buildVerificationSummary({
      status: 'completed',
      institutionName: '杭州星澜医疗美容诊所',
      rawResults,
      riskTags: evidence.map((item) => item.category),
      evidence
    });

    expect(evidence).toEqual([]);
    expect(summary.verificationSummary.judgment).toBe('clear');
    expect(summary.verificationSummary.riskTags).toEqual([]);
  });

  it('creates redline evidence when a matched institution result contains severe risk semantics', () => {
    const rawResults = [
      {
        keyword: '杭州星澜医疗美容诊所 严重违法失信',
        result: {
          title: '杭州星澜医疗美容诊所被列入严重违法失信名单',
          content: '杭州星澜医疗美容诊所因违法经营被列入严重违法失信名单。',
          media: '市场监管示例',
          link: 'https://example.com/risk'
        }
      }
    ];

    const evidence = extractVerificationEvidence('杭州星澜医疗美容诊所', rawResults);
    const riskTags = [...new Set(evidence.map((item) => item.category))];
    const summary = buildVerificationSummary({
      status: 'completed',
      institutionName: '杭州星澜医疗美容诊所',
      rawResults,
      riskTags,
      evidence
    });

    expect(riskTags).toContain('严重违法失信');
    expect(summary.verificationSummary.judgment).toBe('redline_suspected');
    expect(summary.verificationSummary.suggestedPublicCreditStatus).toBe('serious');
  });

  it('extracts unified social credit code candidates only from matched institution results', () => {
    const rawResults = [
      {
        result: {
          title: '杭州星澜医疗美容诊所工商信息',
          content: '杭州星澜医疗美容诊所统一社会信用代码 91330100MA2B123456。',
          media: '企业信息示例',
          link: 'https://example.com/profile'
        }
      },
      {
        result: {
          title: '其他机构工商信息',
          content: '其他机构统一社会信用代码 91330100MA2B999999。',
          media: '企业信息示例',
          link: 'https://example.com/other'
        }
      }
    ];

    const profile = extractBusinessProfile('杭州星澜医疗美容诊所', rawResults);
    const summary = buildVerificationSummary({
      status: 'completed',
      institutionName: '杭州星澜医疗美容诊所',
      rawResults,
      riskTags: [],
      evidence: []
    });

    expect(profile.creditCodeCandidates).toHaveLength(1);
    expect(profile.creditCodeCandidates[0].value).toBe('91330100MA2B123456');
    expect(summary.verificationSummary.businessProfile.creditCodeCandidates[0].value).toBe('91330100MA2B123456');
  });
});
