import { buildVerificationKeywords } from './assessmentContract.js';
import {
  buildFallbackEvidenceInsight,
  buildVerificationSummary,
  extractVerificationEvidence
} from './verificationEvidence.js';

const FAST_SEARCH_PATTERNS = [/行政处罚/, /被执行人/, /失信被执行人/, /非法行医/];

export function createZhipuVerificationService({
  apiKey = process.env.ZHIPUAI_API_KEY || '',
  summaryModel = process.env.ZHIPUAI_SUMMARY_MODEL || 'glm-4-flash',
  searchTimeoutMs = Number(process.env.ZHIPUAI_SEARCH_TIMEOUT_MS || 12000),
  summaryTimeoutMs = Number(process.env.ZHIPUAI_SUMMARY_TIMEOUT_MS || 12000),
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  officialRegistry = {
    provider: 'official_registry',
    status: 'unconfigured',
    message: '未配置官方企业信用接口',
    candidates: []
  }
} = {}) {
  const run = async ({ repository, clientInstanceId, record, form = {}, result = {}, existingLogId }) => {
    const recordId = record?.id;
    const queryKeywords = Array.isArray(result.queryKeywords)
      ? result.queryKeywords
      : buildVerificationKeywords(String(form.institutionName || record?.institutionName || ''));
    const institutionName = String(form.institutionName || record?.institutionName || '').trim();

    if (!recordId) throw new Error('verification service requires a record id.');

    if (!institutionName) {
      await saveLog(repository, clientInstanceId, {
        recordId,
        queryKeywords,
        status: 'skipped',
        rawResults: [],
        extractedFlags: buildVerificationSummary({ status: 'skipped', institutionName, rawResults: [], riskTags: [], evidence: [] }),
        riskTags: [],
        errorMessage: '机构名称为空，跳过后台核验'
      }, { logId: existingLogId });
      return;
    }

    const startedAt = now().toISOString();
    if (!apiKey) {
      await saveLog(repository, clientInstanceId, {
        recordId,
        queryKeywords,
        status: 'pending',
        rawResults: [],
        extractedFlags: buildVerificationSummary({
          status: 'pending',
          institutionName,
          rawResults: [],
          riskTags: [],
          evidence: [],
          officialRegistry
        }),
        riskTags: [],
        startedAt,
        errorMessage: '未配置 ZHIPUAI_API_KEY'
      }, { logId: existingLogId });
      return;
    }

    try {
      const searchPlan = splitVerificationKeywords(queryKeywords.slice(0, 7));
      const totalKeywords = searchPlan.fast.length + searchPlan.remaining.length;
      const fastSearch = await runZhipuSearch({
        queryKeywords: searchPlan.fast,
        clientInstanceId,
        apiKey,
        fetchImpl,
        timeoutMs: searchTimeoutMs
      });
      const fastEvidence = extractVerificationEvidence(institutionName, fastSearch.rawResults);
      const fastRiskTags = [...new Set(fastEvidence.map((item) => item.category))];
      await saveLog(repository, clientInstanceId, {
        recordId,
        queryKeywords,
        status: 'running',
        rawResults: fastSearch.rawResults,
        extractedFlags: buildVerificationSummary({
          status: 'running',
          institutionName,
          rawResults: fastSearch.rawResults,
          riskTags: fastRiskTags,
          evidence: fastEvidence,
          officialRegistry,
          progress: {
            phase: 'searching_full',
            completedKeywords: fastSearch.completed,
            totalKeywords,
            partial: fastSearch.failures.length > 0,
            keywordDiagnostics: fastSearch.keywordDiagnostics
          }
        }),
        riskTags: fastRiskTags,
        startedAt,
        errorMessage: fastSearch.failures.map((item) => item.message).join('；')
      }, { logId: existingLogId });

      const remainingSearch = searchPlan.remaining.length
        ? await runZhipuSearch({
          queryKeywords: searchPlan.remaining,
          clientInstanceId,
          apiKey,
          fetchImpl,
          timeoutMs: searchTimeoutMs
        })
        : { rawResults: [], failures: [], completed: 0, keywordDiagnostics: [] };
      const rawResults = [...fastSearch.rawResults, ...remainingSearch.rawResults];
      const failures = [...fastSearch.failures, ...remainingSearch.failures];
      const keywordDiagnostics = [...fastSearch.keywordDiagnostics, ...remainingSearch.keywordDiagnostics];
      if (!rawResults.length && failures.length) {
        throw new Error(failures.map((item) => item.message).join('；'));
      }

      const evidence = extractVerificationEvidence(institutionName, rawResults);
      const riskTags = [...new Set(evidence.map((item) => item.category))];
      const completedKeywords = fastSearch.completed + remainingSearch.completed;
      let evidenceInsight;
      if (evidence.length) {
        await saveLog(repository, clientInstanceId, {
          recordId,
          queryKeywords,
          status: 'running',
          rawResults,
          extractedFlags: buildVerificationSummary({
            status: 'running',
            institutionName,
            rawResults,
            riskTags,
            evidence,
            officialRegistry,
            evidenceInsight: buildFallbackEvidenceInsight(institutionName, riskTags, evidence),
            progress: {
              phase: 'summarizing',
              completedKeywords,
              totalKeywords,
              partial: failures.length > 0,
              keywordDiagnostics
            }
          }),
          riskTags,
          startedAt,
          errorMessage: failures.map((item) => item.message).join('；')
        }, { logId: existingLogId });
        evidenceInsight = await summarizeEvidenceWithAi({
          institutionName,
          evidence,
          riskTags,
          clientInstanceId,
          apiKey,
          summaryModel,
          fetchImpl,
          timeoutMs: summaryTimeoutMs
        });
      }

      await saveLog(repository, clientInstanceId, {
        recordId,
        queryKeywords,
        status: 'completed',
        rawResults,
        extractedFlags: buildVerificationSummary({
          status: 'completed',
          institutionName,
          rawResults,
          riskTags,
          evidence,
          officialRegistry,
          evidenceInsight,
          progress: {
            phase: 'completed',
            completedKeywords,
            totalKeywords,
            partial: failures.length > 0,
            durationMs: now().getTime() - Date.parse(startedAt),
            keywordDiagnostics
          }
        }),
        riskTags,
        startedAt,
        errorMessage: failures.map((item) => item.message).join('；')
      }, { logId: existingLogId });
    } catch (error) {
      const message = error instanceof Error ? error.message : '智谱联网核验失败';
      await saveLog(repository, clientInstanceId, {
        recordId,
        queryKeywords,
        status: 'failed',
        rawResults: [],
        extractedFlags: buildVerificationSummary({
          status: 'failed',
          institutionName,
          rawResults: [],
          riskTags: [],
          evidence: [],
          officialRegistry,
          errorMessage: message
        }),
        riskTags: [],
        startedAt,
        errorMessage: message
      }, { logId: existingLogId });
    }
  };

  return { run };
}

export function splitVerificationKeywords(queryKeywords = []) {
  const keywords = queryKeywords.map((keyword) => String(keyword || '').trim()).filter(Boolean);
  const fast = [];
  const remaining = [];

  for (const pattern of FAST_SEARCH_PATTERNS) {
    const matched = keywords.find((keyword) => pattern.test(keyword) && !fast.includes(keyword));
    if (matched) fast.push(matched);
  }

  for (const keyword of keywords) {
    if (!fast.includes(keyword)) remaining.push(keyword);
  }

  return {
    fast: fast.slice(0, 4),
    remaining
  };
}

async function saveLog(repository, clientInstanceId, payload, options = {}) {
  return repository.saveVerificationLog(clientInstanceId, payload, options);
}

async function runZhipuSearch({ queryKeywords, clientInstanceId, apiKey, fetchImpl, timeoutMs }) {
  if (!fetchImpl) throw new Error('Fetch API is not available in this Node.js runtime.');
  const settled = await Promise.allSettled(queryKeywords.map(async (keyword) => {
    const keywordText = String(keyword).slice(0, 70);
    try {
      const response = await fetchWithTimeout(fetchImpl, 'https://open.bigmodel.cn/api/paas/v4/web_search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          search_query: keywordText,
          search_engine: 'search_std',
          search_intent: false,
          count: 5,
          search_recency_filter: 'noLimit',
          content_size: 'medium',
          request_id: createId(),
          user_id: clientInstanceId.slice(0, 128)
        })
      }, timeoutMs);

      if (!response.ok) {
        throw new Error(`Zhipu search failed with status ${response.status}`);
      }

      const payload = await response.json();
      return {
        keyword: keywordText,
        results: payload.search_result || []
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Zhipu search failed');
      throw { keyword: keywordText, message: `${keywordText}: ${message}` };
    }
  }));

  const searches = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value);
  const failures = settled
    .filter((item) => item.status === 'rejected')
    .map((item) => ({
      keyword: typeof item.reason?.keyword === 'string' ? item.reason.keyword : '',
      message: typeof item.reason?.message === 'string'
        ? item.reason.message
        : item.reason instanceof Error
          ? item.reason.message
          : String(item.reason || 'Zhipu search failed')
    }));
  const keywordDiagnostics = [
    ...searches.map((search) => ({
      keyword: search.keyword,
      resultCount: Array.isArray(search.results) ? search.results.length : 0
    })),
    ...failures.map((failure) => ({
      keyword: failure.keyword,
      resultCount: 0,
      failed: true,
      errorMessage: failure.message
    }))
  ];

  return {
    rawResults: searches.flatMap((search) => search.results.map((result) => ({ keyword: search.keyword, result }))),
    failures,
    completed: searches.length,
    keywordDiagnostics
  };
}

async function summarizeEvidenceWithAi({
  institutionName,
  evidence,
  riskTags,
  clientInstanceId,
  apiKey,
  summaryModel,
  fetchImpl,
  timeoutMs
}) {
  try {
    const response = await fetchWithTimeout(fetchImpl, 'https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: summaryModel,
        messages: [
          {
            role: 'system',
            content: [
              '你是医美机构授信核验助手。',
              '只能基于用户提供的联网搜索证据做摘要，不得补充未给出的事实。',
              '不要把线索写成已确认结论，必须提示人工打开原文复核。',
              '只输出 JSON，不要 Markdown。'
            ].join('')
          },
          {
            role: 'user',
            content: JSON.stringify({
              institutionName,
              riskTags,
              evidence: evidence.slice(0, 8).map((item) => ({
                category: item.category,
                title: item.title,
                source: item.source,
                sourceHost: item.sourceHost,
                publishDate: item.publishDate,
                url: item.url,
                snippet: item.snippet,
                riskSignal: item.riskSignal
              })),
              outputSchema: {
                overview: '一句话总结线索整体情况，明确这是线索不是结论',
                keyFindings: ['3-5 条关键发现，每条都引用类别或来源'],
                riskQuestions: ['2-4 条人工复核问题'],
                verificationFocus: ['2-4 条下一步核验重点'],
                sourceConfidence: '对来源数量、来源类型、是否需要原文复核的说明'
              }
            })
          }
        ],
        temperature: 0.2,
        user_id: clientInstanceId.slice(0, 128)
      })
    }, timeoutMs);

    if (!response.ok) {
      throw new Error(`Zhipu summary failed with status ${response.status}`);
    }

    const payload = await response.json();
    const content = String(payload?.choices?.[0]?.message?.content || '');
    return normalizeEvidenceInsight(parseJsonContent(content));
  } catch (error) {
    console.error('evidence summary fallback used', error);
    return buildFallbackEvidenceInsight(institutionName, riskTags, evidence);
  }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 12000));
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonContent(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) throw new Error('empty evidence insight response');

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('evidence insight response is not JSON');
    return JSON.parse(match[0]);
  }
}

function normalizeEvidenceInsight(value) {
  const objectValue = value && typeof value === 'object' ? value : {};
  return {
    overview: clipText(String(objectValue.overview || '已提取联网线索，请人工打开原文复核。'), 180),
    keyFindings: normalizeTextList(objectValue.keyFindings, 5),
    riskQuestions: normalizeTextList(objectValue.riskQuestions, 4),
    verificationFocus: normalizeTextList(objectValue.verificationFocus, 4),
    sourceConfidence: clipText(String(objectValue.sourceConfidence || '来源可信度需人工结合原文判断。'), 180)
  };
}

function normalizeTextList(value, limit) {
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((item) => clipText(String(item || '').trim(), 120))
    .filter(Boolean)
    .slice(0, limit);
}

function clipText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
