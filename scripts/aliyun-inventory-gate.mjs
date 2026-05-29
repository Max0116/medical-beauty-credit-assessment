import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function evaluateInventoryGate(report = {}) {
  const blockers = [];
  const warnings = [];
  const signals = report.signals || {};
  const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];
  const counts = report.counts || {};

  if (Number(counts.fail || 0) > 0) {
    blockers.push('只读盘点存在 FAIL 项，必须先排查。');
  }

  if (signals.nginxTest === 'failed') {
    blockers.push('现有 Nginx 配置检查失败，不能继续部署。');
  } else if (signals.nginxTest === 'unknown') {
    warnings.push('未确认 Nginx 配置检查结果，需要 IT 确认。');
  }

  if (signals.targetPort === 'occupied') {
    blockers.push('默认 API 端口 8787 已被占用，需要先确定替代端口。');
  } else if (signals.targetPort === 'unknown') {
    warnings.push('未确认 API 端口 8787 是否可用，需要 IT 确认。');
  }

  if (signals.domesticOutbound === 'warning') {
    blockers.push('国内 HTTPS 出网异常，可能影响部署依赖安装和健康检查。');
  } else if (signals.domesticOutbound === 'unknown') {
    warnings.push('未确认国内 HTTPS 出网状态。');
  }

  if (signals.zhipuOutbound === 'warning') {
    warnings.push('智谱 API 出网异常，联网核验可能失败。');
  } else if (signals.zhipuOutbound === 'unknown') {
    warnings.push('未确认智谱 API 出网状态。');
  }

  if (signals.medicalCreditService === 'exists') {
    warnings.push('服务器上已存在 medical-credit-api.service，需确认是否为本项目历史服务，避免覆盖未知服务。');
  }

  if (recommendations.some((item) => /Node\.js \/ npm 缺失|node is not installed|npm is not installed/i.test(item))) {
    blockers.push('Node.js / npm 缺失，需要先安装 Node.js 20+。');
  }

  const decision = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'manual_review' : 'go';
  const nextSteps = buildNextSteps(decision);

  return {
    ok: decision === 'go',
    decision,
    blockers,
    warnings,
    nextSteps,
    sourceGeneratedAt: report.generatedAt || '',
    sourceFile: report.sourceFile || ''
  };
}

export function renderInventoryGateMarkdown(gate) {
  const decisionLabels = {
    go: '可以进入下一步',
    manual_review: '需要人工复核',
    blocked: '暂停部署'
  };

  return [
    '# PR23 阿里云部署闸门判断',
    '',
    `判断：${decisionLabels[gate.decision] || gate.decision}`,
    gate.sourceGeneratedAt ? `盘点时间：${gate.sourceGeneratedAt}` : '',
    gate.sourceFile ? `盘点来源：${gate.sourceFile}` : '',
    '',
    '## 阻断项',
    '',
    ...formatList(gate.blockers, '无阻断项。'),
    '',
    '## 需复核项',
    '',
    ...formatList(gate.warnings, '无需要人工复核项。'),
    '',
    '## 下一步',
    '',
    ...formatList(gate.nextSteps, '继续按 PR23 交接单执行。'),
    ''
  ].filter((line) => line !== '').join('\n');
}

export async function readAndEvaluateInventoryGate({
  inputFile,
  outputFile,
  markdownOutputFile,
  readFileImpl = readFile,
  writeFileImpl = writeFile
} = {}) {
  if (!inputFile) {
    throw new Error('INVENTORY_REPORT_FILE is required.');
  }

  const report = JSON.parse(await readFileImpl(inputFile, 'utf8'));
  const gate = evaluateInventoryGate(report);

  if (outputFile) {
    await writeFileImpl(outputFile, `${JSON.stringify(gate, null, 2)}\n`);
  }

  if (markdownOutputFile) {
    await writeFileImpl(markdownOutputFile, renderInventoryGateMarkdown(gate));
  }

  return gate;
}

function buildNextSteps(decision) {
  if (decision === 'blocked') {
    return [
      '暂停 PR23 部署。',
      '先让 IT 处理阻断项，再重新执行只读盘点和闸门判断。',
      '不要修改现有 Nginx、目录、服务或数据库配置。'
    ];
  }

  if (decision === 'manual_review') {
    return [
      '先由 IT 或负责人确认需复核项。',
      '确认后再创建 `.env` 并执行 `bash ops/aliyun/preflight-release.sh.example`。',
      '仍然先使用 `MEDICAL_CREDIT_BACKEND_MODE=dual_write` 灰度。'
    ];
  }

  return [
    '可以进入 PR23 部署前配置预检。',
    '创建服务端 `.env` 后执行 preflight。',
    '先保持 `MEDICAL_CREDIT_BACKEND_MODE=dual_write`，验收通过后再切 `aliyun`。'
  ];
}

function formatList(items = [], emptyText) {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const inputFile = process.env.INVENTORY_REPORT_FILE || process.argv[2];
  const outputFile = process.env.INVENTORY_GATE_OUTPUT_FILE;
  const markdownOutputFile = process.env.INVENTORY_GATE_MARKDOWN_FILE;
  const gate = await readAndEvaluateInventoryGate({ inputFile, outputFile, markdownOutputFile });
  console.log(JSON.stringify(gate, null, 2));
  if (gate.decision === 'blocked') {
    process.exit(1);
  }
}
