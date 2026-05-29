import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_OUTPUT_DIR = 'release/inventory';

export function redactSensitiveText(text = '') {
  return String(text)
    .replace(/([?&](?:apikey|api_key|token|secret|password|key)=)[^&\s]+/gi, '$1<redacted>')
    .split('\n')
    .map((line) => {
      if (/^\s*-\s*[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY|SERVICE_ROLE|PRIVATE_KEY|ZHIPUAI)[A-Z0-9_]*=/.test(line)) {
        return line.replace(/=.*/, '=<redacted>');
      }
      if (/^\s*[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY|SERVICE_ROLE|PRIVATE_KEY|ZHIPUAI)[A-Z0-9_]*=/.test(line)) {
        return line.replace(/=.*/, '=<redacted>');
      }
      if (/^\s*[^:=\s]*(password|secret|token|access[_-]?key|api[_-]?key|service[_-]?role|private[_-]?key)[^:=\s]*\s*[:=]/i.test(line)) {
        return line.replace(/([:=]\s*)(?!<redacted>)[^,\s]+/g, '$1<redacted>');
      }
      return line;
    })
    .join('\n');
}

export function parseInventoryOutput(rawText = '', { generatedAt = new Date().toISOString(), sourceFile = '' } = {}) {
  const redactedText = redactSensitiveText(rawText);
  const sections = splitSections(redactedText);
  const allLines = sections.flatMap((section) => section.lines);
  const counts = {
    ok: allLines.filter((line) => line.startsWith('OK   ')).length,
    warn: allLines.filter((line) => line.startsWith('WARN ')).length,
    fail: allLines.filter((line) => line.startsWith('FAIL ')).length
  };
  const signals = extractSignals(sections, allLines);
  const recommendations = buildRecommendations({ counts, signals, allLines });

  return {
    type: 'aliyun_server_inventory_report',
    generatedAt,
    sourceFile,
    counts,
    signals,
    recommendations,
    sections
  };
}

export function renderInventoryMarkdown(report) {
  const signalRows = [
    ['Nginx 配置检查', labelSignal(report.signals.nginxTest)],
    ['API 目标端口', labelSignal(report.signals.targetPort)],
    ['国内 HTTPS 出网', labelSignal(report.signals.domesticOutbound)],
    ['智谱 API 出网', labelSignal(report.signals.zhipuOutbound)],
    ['medical-credit-api 服务', labelSignal(report.signals.medicalCreditService)],
    ['PM2 状态', labelSignal(report.signals.pm2)]
  ];

  return [
    '# PR23 阿里云服务器只读盘点报告',
    '',
    `生成时间：${report.generatedAt}`,
    report.sourceFile ? `来源文件：${report.sourceFile}` : '',
    '',
    '## 状态汇总',
    '',
    `- OK：${report.counts.ok}`,
    `- WARN：${report.counts.warn}`,
    `- FAIL：${report.counts.fail}`,
    '',
    '## 关键判断',
    '',
    '| 项目 | 结果 |',
    '| --- | --- |',
    ...signalRows.map(([label, value]) => `| ${label} | ${value} |`),
    '',
    '## 目标目录线索',
    '',
    ...formatPathSignals(report.signals.candidatePaths),
    '',
    '## 环境文件线索',
    '',
    ...formatList(report.signals.envFiles, '未发现目标 `.env` 文件。'),
    '',
    '## 建议动作',
    '',
    ...formatList(report.recommendations, '未发现阻断项；继续按 PR23 交接单执行 preflight。'),
    '',
    '## 脱敏原始盘点输出',
    '',
    '```text',
    renderRedactedSections(report.sections),
    '```',
    ''
  ].filter((line) => line !== '').join('\n');
}

export async function writeInventoryReport({
  inputFile,
  outputDir = DEFAULT_OUTPUT_DIR,
  reportBaseName,
  generatedAt = new Date().toISOString(),
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  mkdirImpl = mkdir
} = {}) {
  if (!inputFile) {
    throw new Error('INVENTORY_INPUT_FILE is required.');
  }

  const rawText = await readFileImpl(inputFile, 'utf8');
  const report = parseInventoryOutput(rawText, { generatedAt, sourceFile: inputFile });
  const baseName = reportBaseName || buildReportBaseName(inputFile, generatedAt);
  await mkdirImpl(outputDir, { recursive: true });

  const jsonPath = join(outputDir, `${baseName}.json`);
  const markdownPath = join(outputDir, `${baseName}.md`);
  await writeFileImpl(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFileImpl(markdownPath, renderInventoryMarkdown(report));

  return {
    report,
    jsonPath,
    markdownPath
  };
}

function splitSections(text) {
  const sections = [];
  let current = { title: 'Preamble', lines: [] };

  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^==\s+(.+?)\s+==$/);
    if (match) {
      if (current.lines.length > 0 || current.title !== 'Preamble') {
        sections.push(current);
      }
      current = { title: match[1], lines: [] };
    } else {
      current.lines.push(line);
    }
  }

  if (current.lines.length > 0 || current.title !== 'Preamble') {
    sections.push(current);
  }

  return sections.map((section) => ({
    ...section,
    lines: section.lines.filter((line, index, lines) => line.trim() || index < lines.length - 1)
  }));
}

function extractSignals(sections, allLines) {
  return {
    nginxTest: classifyByLines(allLines, [
      ['failed', /nginx -t failed/i],
      ['passed', /nginx -t passed/i]
    ]),
    targetPort: classifyByLines(allLines, [
      ['occupied', /8787.*already listening|8787.*appears to be listening/i],
      ['free', /8787.*appears free/i]
    ]),
    domesticOutbound: classifyByLines(allLines, [
      ['warning', /domestic HTTPS outbound failed/i],
      ['ok', /domestic HTTPS outbound works/i]
    ]),
    zhipuOutbound: classifyByLines(allLines, [
      ['warning', /Zhipu endpoint check failed/i],
      ['ok', /Zhipu endpoint appears reachable/i]
    ]),
    medicalCreditService: classifyByLines(allLines, [
      ['exists', /medical-credit-api\.service already exists/i],
      ['not_registered', /medical-credit-api\.service is not registered yet/i]
    ]),
    pm2: classifyByLines(allLines, [
      ['missing', /pm2 missing/i],
      ['present', /pid=.*status=/i]
    ]),
    candidatePaths: extractCandidatePaths(sections),
    envFiles: allLines
      .map((line) => line.trim())
      .filter((line) => /\/medical-credit-api\/\.env/.test(line))
  };
}

function extractCandidatePaths(sections) {
  const section = sections.find((item) => item.title === 'Candidate isolated target paths');
  if (!section) return [];
  return section.lines
    .map((line) => line.trim())
    .filter((line) => /medical-credit/.test(line) && /^(OK|WARN)/.test(line));
}

function classifyByLines(lines, rules) {
  const match = rules.find(([, pattern]) => lines.some((line) => pattern.test(line)));
  return match ? match[0] : 'unknown';
}

function buildRecommendations({ counts, signals, allLines }) {
  const recommendations = [];
  if (counts.fail > 0) {
    recommendations.push('存在 FAIL 项，暂停部署，先让 IT 排查。');
  }
  if (signals.nginxTest === 'failed') {
    recommendations.push('现有 Nginx 配置检查失败，部署前必须由 IT 修复或确认。');
  }
  if (signals.targetPort === 'occupied') {
    recommendations.push('默认 API 端口 8787 已被占用，需要选择替代端口并同步 Nginx / systemd 配置。');
  }
  if (signals.domesticOutbound === 'warning') {
    recommendations.push('国内 HTTPS 出网异常，需确认服务器网络或安全组。');
  }
  if (signals.zhipuOutbound === 'warning') {
    recommendations.push('智谱 API 出网异常，联网核验可能失败，需先确认出口策略。');
  }
  if (allLines.some((line) => /node is not installed|npm is not installed/i.test(line))) {
    recommendations.push('Node.js / npm 缺失，需安装 Node.js 20+ 后再部署 API。');
  }
  if (signals.medicalCreditService === 'exists') {
    recommendations.push('目标 systemd 服务已存在，部署前确认是否为本项目历史服务，避免覆盖未知服务。');
  }
  if (recommendations.length === 0) {
    recommendations.push('未发现明显阻断项；继续创建 `.env` 并执行 PR23 preflight。');
  }
  return recommendations;
}

function labelSignal(value) {
  const labels = {
    passed: '通过',
    failed: '失败',
    free: '空闲',
    occupied: '已占用',
    ok: '正常',
    warning: '需关注',
    exists: '已存在',
    not_registered: '未注册',
    present: '存在',
    missing: '未发现',
    unknown: '未知'
  };
  return labels[value] || value || '未知';
}

function formatPathSignals(paths = []) {
  if (!paths.length) return ['- 未发现目标目录线索。'];
  return paths.map((line) => `- ${line}`);
}

function formatList(items = [], emptyText) {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

function renderRedactedSections(sections = []) {
  return sections
    .map((section) => [
      `== ${section.title} ==`,
      ...section.lines
    ].join('\n'))
    .join('\n\n')
    .trim();
}

function buildReportBaseName(inputFile, generatedAt) {
  const source = basename(inputFile).replace(/\.[^.]+$/, '') || 'aliyun-server-inventory';
  const timestamp = String(generatedAt).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/[^0-9TZ]/g, '');
  return `${source}-${timestamp || 'report'}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const inputFile = process.env.INVENTORY_INPUT_FILE || process.argv[2];
  const outputDir = process.env.INVENTORY_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
  const reportBaseName = process.env.INVENTORY_REPORT_BASENAME;
  const result = await writeInventoryReport({ inputFile, outputDir, reportBaseName });
  console.log(JSON.stringify({
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath,
    counts: result.report.counts,
    signals: result.report.signals,
    recommendations: result.report.recommendations
  }, null, 2));
}
