import { describe, expect, it } from 'vitest';
import {
  buildBusinessProfile,
  buildFallbackEvidenceInsight,
  buildVerificationSummary,
  extractVerificationEvidence
} from './verificationEvidence.ts';

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
    expect(evidence[0].sourceHost).toBe('example.com');
    expect(evidence[0].riskSignal).toContain('严重违法失信');
    expect(summary.verificationSummary.judgment).toBe('redline_suspected');
    expect(summary.verificationSummary.evidenceInsight.overview).toContain('杭州星澜医疗美容诊所');
    expect(summary.verificationSummary.evidenceInsight.keyFindings[0]).toContain('严重违法失信');
    expect(summary.verificationSummary.suggestedPublicCreditStatus).toBe('serious');
  });

  it('keeps AI evidence insight in the verification summary when provided', () => {
    const rawResults = [
      {
        result: {
          title: '杭州星澜医疗美容诊所行政处罚信息',
          content: '杭州星澜医疗美容诊所因医疗广告违法受到行政处罚。',
          media: '监管公告',
          link: 'https://example.com/penalty',
          publish_date: '2026-01-01'
        }
      }
    ];
    const evidence = extractVerificationEvidence('杭州星澜医疗美容诊所', rawResults);
    const riskTags = [...new Set(evidence.map((item) => item.category))];
    const evidenceInsight = buildFallbackEvidenceInsight('杭州星澜医疗美容诊所', riskTags, evidence);
    const summary = buildVerificationSummary({
      status: 'completed',
      institutionName: '杭州星澜医疗美容诊所',
      rawResults,
      riskTags,
      evidence,
      evidenceInsight
    });

    expect(summary.verificationSummary.evidenceInsight).toEqual(evidenceInsight);
    expect(summary.verificationSummary.evidenceSummaries[0].snippet).toContain('医疗广告违法');
    expect(summary.verificationSummary.evidenceSummaries[0].url).toBe('https://example.com/penalty');
  });

  it('keeps progressive verification status while keyword searches are still running', () => {
    const rawResults = [
      {
        result: {
          title: '杭州星澜医疗美容诊所行政处罚信息',
          content: '杭州星澜医疗美容诊所因医疗广告违法受到行政处罚。',
          media: '监管公告',
          link: 'https://example.com/penalty'
        }
      }
    ];
    const evidence = extractVerificationEvidence('杭州星澜医疗美容诊所', rawResults);
    const riskTags = [...new Set(evidence.map((item) => item.category))];
    const summary = buildVerificationSummary({
      status: 'running',
      institutionName: '杭州星澜医疗美容诊所',
      rawResults,
      riskTags,
      evidence,
      progress: {
        phase: 'searching_full',
        completedKeywords: 2,
        totalKeywords: 7,
        partial: true
      }
    });

    expect(summary.verificationSummary.status).toBe('running');
    expect(summary.verificationSummary.phase).toBe('searching_full');
    expect(summary.verificationSummary.completedKeywords).toBe(2);
    expect(summary.verificationSummary.partial).toBe(true);
    expect(summary.verificationSummary.evidenceSummaries.length).toBeGreaterThan(0);
    expect(summary.verificationSummary.riskTags).toContain('行政处罚');
  });

  it('builds unified social credit code candidates from official registry results only', () => {
    const officialRegistry = {
      provider: 'official_registry',
      status: 'completed',
      message: '官方企业信用接口已返回候选',
      candidates: [
        {
          name: '杭州星澜医疗美容诊所',
          creditCode: '91330100MA2B123456',
          registrationStatus: '存续',
          legalRepresentative: '张三',
          registeredAddress: '杭州市示例路 1 号',
          businessScope: '医疗美容服务',
          source: 'official_registry',
          sourceUrl: 'https://example.com/profile'
        }
      ]
    };

    const profile = buildBusinessProfile(officialRegistry);
    const summary = buildVerificationSummary({
      status: 'completed',
      institutionName: '杭州星澜医疗美容诊所',
      rawResults: [],
      riskTags: [],
      evidence: [],
      officialRegistry
    });

    expect(profile.creditCodeCandidates).toHaveLength(1);
    expect(profile.creditCodeCandidates[0].value).toBe('91330100MA2B123456');
    expect(profile.registryStatus).toBe('completed');
    expect(summary.verificationSummary.businessProfile.creditCodeCandidates[0].value).toBe('91330100MA2B123456');
  });

  it('does not use web search snippets as credit code candidates when official registry is absent', () => {
    const rawResults = [
      {
        result: {
          title: '杭州星澜医疗美容诊所工商信息',
          content: '杭州星澜医疗美容诊所统一社会信用代码 91330100MA2B123456。',
          media: '网页摘要',
          link: 'https://example.com/profile'
        }
      }
    ];

    const summary = buildVerificationSummary({
      status: 'completed',
      institutionName: '杭州星澜医疗美容诊所',
      rawResults,
      riskTags: [],
      evidence: []
    });

    expect(summary.verificationSummary.businessProfile.registryStatus).toBe('unconfigured');
    expect(summary.verificationSummary.businessProfile.creditCodeCandidates).toEqual([]);
  });

  it('keeps transparent keyword counts and raw result relevance reasons in the summary', () => {
    const rawResults = [
      {
        keyword: '杭州星澜医疗美容诊所 行政处罚',
        result: {
          title: '杭州星澜医疗美容诊所行政处罚信息',
          content: '杭州星澜医疗美容诊所因医疗广告违法受到行政处罚。',
          media: '监管公告',
          link: 'https://example.com/penalty'
        }
      },
      {
        keyword: '杭州星澜医疗美容诊所 行政处罚',
        result: {
          title: '行政处罚查询入口',
          content: '本文介绍行政处罚查询方式，没有目标机构名称。',
          media: '服务指南',
          link: 'https://example.com/search-help'
        }
      },
      {
        keyword: '杭州星澜医疗美容诊所 被执行人',
        result: {
          title: '杭州星澜医疗美容诊所公开资料',
          content: '杭州星澜医疗美容诊所公开资料页面，介绍门诊服务与地址信息。',
          media: '公开网页',
          link: 'https://example.com/profile'
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
    }).verificationSummary;

    expect(summary.keywordDiagnostics).toEqual([
      expect.objectContaining({ keyword: '杭州星澜医疗美容诊所 行政处罚', resultCount: 2, evidenceCount: 1 }),
      expect.objectContaining({ keyword: '杭州星澜医疗美容诊所 被执行人', resultCount: 1, evidenceCount: 0 })
    ]);
    expect(summary.rawResultItems).toHaveLength(3);
    expect(summary.rawResultItems[0]).toEqual(expect.objectContaining({
      keyword: '杭州星澜医疗美容诊所 行政处罚',
      title: '杭州星澜医疗美容诊所行政处罚信息',
      isRelevant: true,
      riskTags: expect.arrayContaining(['行政处罚', '医美处罚'])
    }));
    expect(summary.rawResultItems[0].relevanceReason).toContain('机构名称');
    expect(summary.rawResultItems[1].isRelevant).toBe(false);
    expect(summary.rawResultItems[1].relevanceReason).toContain('未确认指向本机构');
    expect(summary.rawResultItems[2].isRelevant).toBe(false);
    expect(summary.rawResultItems[2].relevanceReason).toContain('未命中风险关键词');
  });

  it('states that completed searches produced no risk evidence when results are clear', () => {
    const rawResults = [
      {
        keyword: '杭州星澜医疗美容诊所 失信被执行人',
        result: {
          title: '杭州星澜医疗美容诊所公开资料',
          content: '杭州星澜医疗美容诊所公开资料页面，未提及失信信息。',
          media: '公开网页',
          link: 'https://example.com/profile'
        }
      }
    ];
    const summary = buildVerificationSummary({
      status: 'completed',
      institutionName: '杭州星澜医疗美容诊所',
      rawResults,
      riskTags: [],
      evidence: []
    }).verificationSummary;

    expect(summary.conclusion).toContain('已查询');
    expect(summary.conclusion).toContain('未形成风险证据');
    expect(summary.evidenceInsight.overview).toContain('已查询');
    expect(summary.evidenceInsight.overview).toContain('未形成风险证据');
    expect(summary.rawResultItems[0].isRelevant).toBe(false);
  });
});
