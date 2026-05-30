import { describe, expect, it } from 'vitest';
import { buildVerificationKeywords } from './assessmentContract.js';
import { createZhipuVerificationService, splitVerificationKeywords } from './zhipuVerificationService.js';

describe('Zhipu verification service', () => {
  it('reports configuration readiness for health checks', async () => {
    const configured = createZhipuVerificationService({
      apiKey: 'zhipu-test-key',
      fetchImpl: async () => createJsonResponse({}),
      searchTimeoutMs: 5000,
      summaryTimeoutMs: 6000,
      summaryModel: 'glm-test'
    });
    await expect(configured.health()).resolves.toMatchObject({
      ok: true,
      configured: true,
      provider: 'zhipu_web_search',
      searchEngine: 'search_std',
      summaryModel: 'glm-test',
      searchTimeoutMs: 5000,
      summaryTimeoutMs: 6000
    });

    const unconfigured = createZhipuVerificationService({
      apiKey: '',
      fetchImpl: async () => createJsonResponse({})
    });
    await expect(unconfigured.health()).resolves.toMatchObject({
      ok: false,
      configured: false,
      provider: 'zhipu_web_search',
      reason: 'missing_api_key'
    });
  });

  it('splits verification keywords into fast screening and background completion phases', () => {
    const keywords = buildVerificationKeywords('上海愉悦美联臣医疗美容医院');
    expect(splitVerificationKeywords(keywords)).toEqual({
      fast: [
        '上海愉悦美联臣医疗美容医院 行政处罚',
        '上海愉悦美联臣医疗美容医院 被执行人',
        '上海愉悦美联臣医疗美容医院 失信被执行人',
        '上海愉悦美联臣医疗美容医院 非法行医'
      ],
      remaining: [
        '上海愉悦美联臣医疗美容医院 医疗美容处罚',
        '上海愉悦美联臣医疗美容医院 经营异常',
        '上海愉悦美联臣医疗美容医院 严重违法失信'
      ]
    });
  });

  it('runs two-stage search, stores transparent raw results, and completes with AI insight', async () => {
    const repository = createMemoryVerificationRepository();
    const fetchCalls = [];
    const fetchImpl = async (url, options = {}) => {
      fetchCalls.push({ url, body: JSON.parse(options.body || '{}') });
      if (url.includes('/web_search')) {
        const query = JSON.parse(options.body).search_query;
        return createJsonResponse({
          search_result: [
            {
              title: '监管处罚公示',
              content: '上海愉悦美联臣医疗美容医院 因医疗广告违法受到行政处罚，处罚决定已公开。',
              media: '监管公示网',
              link: `https://example.com/${encodeURIComponent(query)}`,
              publish_date: '2026-05-01'
            }
          ]
        });
      }
      if (url.includes('/chat/completions')) {
        return createJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  overview: '发现行政处罚线索，需人工打开原文复核。',
                  keyFindings: ['行政处罚：监管公示网'],
                  riskQuestions: ['是否为同一主体？'],
                  verificationFocus: ['核对统一社会信用代码'],
                  sourceConfidence: '来源为公开网页，需人工复核。'
                })
              }
            }
          ]
        });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const service = createZhipuVerificationService({
      apiKey: 'zhipu-test-key',
      fetchImpl,
      now: fixedNow
    });

    await service.run({
      repository,
      clientInstanceId: 'client-1',
      record: { id: 'record-1' },
      form: { institutionName: '上海愉悦美联臣医疗美容医院' },
      result: { queryKeywords: buildVerificationKeywords('上海愉悦美联臣医疗美容医院') }
    });

    expect(repository.logs.map((log) => log.status)).toEqual(['running', 'running', 'completed']);
    expect(fetchCalls.filter((call) => call.url.includes('/web_search'))).toHaveLength(7);
    expect(fetchCalls.filter((call) => call.url.includes('/chat/completions'))).toHaveLength(1);
    expect(repository.logs[0].extractedFlags.verificationSummary.phase).toBe('searching_full');
    expect(repository.logs[1].extractedFlags.verificationSummary.phase).toBe('summarizing');
    expect(repository.logs[2]).toMatchObject({
      status: 'completed',
      riskTags: expect.arrayContaining(['行政处罚', '医美处罚'])
    });
    expect(repository.logs[2].rawResults).toHaveLength(7);
    expect(repository.logs[2].extractedFlags).toMatchObject({
      majorMedicalPenalty: true,
      verificationSummary: {
        judgmentLabel: '疑似红线风险',
        suggestedPublicCreditStatus: 'serious',
        evidenceInsight: {
          overview: '发现行政处罚线索，需人工打开原文复核。'
        }
      }
    });
    expect(repository.logs[2].extractedFlags.verificationSummary.rawResultItems[0]).toMatchObject({
      isRelevant: true,
      relevanceStatus: 'relevant',
      relevanceReason: '机构名称与风险关键词同时命中，需人工打开原文确认主体一致性。'
    });
  });

  it('uses pending status when Zhipu key is not configured', async () => {
    const repository = createMemoryVerificationRepository();
    const service = createZhipuVerificationService({
      apiKey: '',
      fetchImpl: async () => {
        throw new Error('should not call fetch');
      },
      now: fixedNow
    });

    await service.run({
      repository,
      clientInstanceId: 'client-1',
      record: { id: 'record-1' },
      form: { institutionName: '上海星澜医疗美容诊所' },
      result: {}
    });

    expect(repository.logs).toHaveLength(1);
    expect(repository.logs[0]).toMatchObject({
      status: 'pending',
      errorMessage: '未配置 ZHIPUAI_API_KEY'
    });
    expect(repository.logs[0].extractedFlags.verificationSummary.businessProfile).toMatchObject({
      registryStatus: 'unconfigured'
    });
  });

  it('keeps partial successful search results when one keyword fails', async () => {
    const repository = createMemoryVerificationRepository();
    const fetchImpl = async (url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      if (url.includes('/web_search') && body.search_query.includes('经营异常')) {
        return createJsonResponse({ error: 'temporary' }, 503);
      }
      if (url.includes('/web_search')) {
        return createJsonResponse({
          search_result: [
            {
              title: '机构公开信息',
              content: '上海星澜医疗美容诊所 未见明显风险。',
              media: '网页',
              link: 'https://example.com/clear'
            }
          ]
        });
      }
      return createJsonResponse({ choices: [{ message: { content: '{}' } }] });
    };
    const service = createZhipuVerificationService({
      apiKey: 'zhipu-test-key',
      fetchImpl,
      now: fixedNow
    });

    await service.run({
      repository,
      clientInstanceId: 'client-1',
      record: { id: 'record-1' },
      form: { institutionName: '上海星澜医疗美容诊所' },
      result: { queryKeywords: buildVerificationKeywords('上海星澜医疗美容诊所') }
    });

    const completed = repository.logs.at(-1);
    expect(completed.status).toBe('completed');
    expect(completed.rawResults).toHaveLength(6);
    expect(completed.errorMessage).toContain('经营异常');
    expect(completed.extractedFlags.verificationSummary.partial).toBe(true);
    expect(completed.extractedFlags.verificationSummary.judgmentLabel).toBe('未发现明显风险');
  });
});

function createMemoryVerificationRepository() {
  return {
    logs: [],
    async saveVerificationLog(_clientInstanceId, payload) {
      this.logs.push(payload);
      return { verificationLog: { id: `log-${this.logs.length}`, ...payload } };
    }
  };
}

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function fixedNow() {
  return new Date('2026-05-30T00:00:00.000Z');
}
