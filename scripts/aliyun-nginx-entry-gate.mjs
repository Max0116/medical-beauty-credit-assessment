import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_TARGET_NAMES = ['credit.xxx.com'];

export function parseNginxServerBlocks(rawText = '') {
  const blocks = [];
  let currentFile = '';
  let current = null;
  let depth = 0;

  for (const line of String(rawText).split(/\r?\n/)) {
    const fileMatch = line.match(/^#\s*configuration file\s+(.+?):\s*$/i);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    const stripped = stripInlineComment(line);
    if (!current && /\bserver\s*\{/.test(stripped)) {
      current = {
        file: currentFile,
        lines: [line],
        listen: [],
        serverNames: [],
        roots: [],
        proxyPasses: [],
        containsMedicalCredit: false,
        containsHearUs: false
      };
      depth = countChar(stripped, '{') - countChar(stripped, '}');
      collectServerDirective(current, stripped);
      if (depth <= 0) {
        blocks.push(finalizeBlock(current));
        current = null;
      }
      continue;
    }

    if (current) {
      current.lines.push(line);
      current.containsMedicalCredit ||= /medical-credit/i.test(line);
      current.containsHearUs ||= /hear-us/i.test(line);
      collectServerDirective(current, stripped);
      depth += countChar(stripped, '{') - countChar(stripped, '}');
      if (depth <= 0) {
        blocks.push(finalizeBlock(current));
        current = null;
      }
    }
  }

  return blocks;
}

export function evaluateNginxEntryGate(rawText = '', {
  targetServerNames = DEFAULT_TARGET_NAMES,
  generatedAt = new Date().toISOString(),
  sourceFile = ''
} = {}) {
  const normalizedTargets = normalizeTargetNames(targetServerNames);
  const blocks = parseNginxServerBlocks(rawText);
  const groups = groupBlocksByNameAndListen(blocks);
  const conflicts = [...groups.values()].filter((group) => group.blocks.length > 1);
  const targetMatches = findTargetMatches(blocks, normalizedTargets);
  const blockers = [];
  const warnings = [];

  for (const target of normalizedTargets) {
    const matches = targetMatches[target] || [];
    if (matches.length === 0) {
      warnings.push(`目标入口 ${target} 尚未出现在 Nginx server_name 中，需要 IT 创建独立 vhost。`);
      continue;
    }

    const conflictGroups = conflicts.filter((group) => group.serverName === target);
    if (conflictGroups.length > 0) {
      blockers.push(`目标入口 ${target} 存在重复 server_name 配置，切换前必须拆分独立域名或清理冲突。`);
    }

    if (matches.some((block) => !block.containsMedicalCredit)) {
      blockers.push(`目标入口 ${target} 当前命中了非 medical-credit 项目，禁止直接切换。`);
    }
  }

  const medicalCreditBlocks = blocks.filter((block) => block.containsMedicalCredit);
  const hearUsBlocks = blocks.filter((block) => block.containsHearUs);
  if (medicalCreditBlocks.length === 0) {
    warnings.push('未发现 medical-credit 相关 Nginx server block；需要新增独立 vhost 后再切换。');
  }

  if (conflicts.some((group) => group.blocks.some((block) => block.containsMedicalCredit))) {
    blockers.push('medical-credit 相关 vhost 存在 server_name 冲突，Nginx 可能会忽略其中一个配置。');
  }

  const uniqueBlockers = unique(blockers);
  const uniqueWarnings = unique(warnings);
  const decision = uniqueBlockers.length > 0 ? 'blocked' : uniqueWarnings.length > 0 ? 'manual_review' : 'go';

  return {
    type: 'aliyun_nginx_entry_gate',
    generatedAt,
    sourceFile,
    ok: decision === 'go',
    decision,
    targetServerNames: normalizedTargets,
    summary: {
      serverBlockCount: blocks.length,
      conflictCount: conflicts.length,
      medicalCreditBlockCount: medicalCreditBlocks.length,
      hearUsBlockCount: hearUsBlocks.length
    },
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    conflicts: conflicts.map(renderGroup),
    targetMatches: Object.fromEntries(
      Object.entries(targetMatches).map(([target, matches]) => [target, matches.map(renderBlock)])
    ),
    recommendations: buildRecommendations(decision)
  };
}

export function renderNginxEntryGateMarkdown(gate) {
  const labels = {
    go: '可以继续',
    manual_review: '需要人工复核',
    blocked: '暂停切换'
  };

  return [
    '# PR23 Nginx 入口归属闸门',
    '',
    `判断：${labels[gate.decision] || gate.decision}`,
    `生成时间：${gate.generatedAt}`,
    gate.sourceFile ? `来源文件：${gate.sourceFile}` : '',
    '',
    '## 目标入口',
    '',
    ...gate.targetServerNames.map((name) => `- ${name}`),
    '',
    '## 汇总',
    '',
    `- server block：${gate.summary.serverBlockCount}`,
    `- server_name 冲突组：${gate.summary.conflictCount}`,
    `- medical-credit block：${gate.summary.medicalCreditBlockCount}`,
    `- hear-us block：${gate.summary.hearUsBlockCount}`,
    '',
    '## 阻断项',
    '',
    ...formatList(gate.blockers, '无阻断项。'),
    '',
    '## 需复核项',
    '',
    ...formatList(gate.warnings, '无需要人工复核项。'),
    '',
    '## 目标入口命中',
    '',
    ...formatTargetMatches(gate.targetMatches),
    '',
    '## 冲突组',
    '',
    ...formatConflicts(gate.conflicts),
    '',
    '## 下一步',
    '',
    ...formatList(gate.recommendations, '继续按 PR23 runbook 执行。'),
    ''
  ].filter((line) => line !== '').join('\n');
}

export async function readAndEvaluateNginxEntryGate({
  inputFile,
  targetServerNames,
  outputFile,
  markdownOutputFile,
  generatedAt = new Date().toISOString(),
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  stdinText = ''
} = {}) {
  const rawText = inputFile ? await readFileImpl(inputFile, 'utf8') : stdinText;
  if (!String(rawText || '').trim()) {
    throw new Error('NGINX_DUMP_FILE or stdin nginx -T output is required.');
  }

  const gate = evaluateNginxEntryGate(rawText, {
    targetServerNames,
    generatedAt,
    sourceFile: inputFile || 'stdin'
  });

  if (outputFile) {
    await writeFileImpl(outputFile, `${JSON.stringify(gate, null, 2)}\n`);
  }
  if (markdownOutputFile) {
    await writeFileImpl(markdownOutputFile, renderNginxEntryGateMarkdown(gate));
  }

  return gate;
}

function collectServerDirective(block, line) {
  block.containsMedicalCredit ||= /medical-credit/i.test(line);
  block.containsHearUs ||= /hear-us/i.test(line);

  const listenMatch = line.match(/^\s*listen\s+([^;]+);/i);
  if (listenMatch) {
    block.listen.push(normalizeListen(listenMatch[1]));
  }

  const serverNameMatch = line.match(/^\s*server_name\s+([^;]+);/i);
  if (serverNameMatch) {
    block.serverNames.push(...serverNameMatch[1].split(/\s+/).map((name) => name.trim()).filter(Boolean));
  }

  const rootMatch = line.match(/^\s*root\s+([^;]+);/i);
  if (rootMatch) {
    block.roots.push(rootMatch[1].trim());
  }

  const proxyMatch = line.match(/^\s*proxy_pass\s+([^;]+);/i);
  if (proxyMatch) {
    block.proxyPasses.push(proxyMatch[1].trim());
  }
}

function finalizeBlock(block) {
  return {
    ...block,
    listen: unique(block.listen.length ? block.listen : ['80']),
    serverNames: unique(block.serverNames),
    roots: unique(block.roots),
    proxyPasses: unique(block.proxyPasses)
  };
}

function groupBlocksByNameAndListen(blocks) {
  const groups = new Map();
  for (const block of blocks) {
    for (const serverName of block.serverNames) {
      for (const listen of block.listen) {
        const key = `${serverName}@@${listen}`;
        const group = groups.get(key) || { serverName, listen, blocks: [] };
        group.blocks.push(block);
        groups.set(key, group);
      }
    }
  }
  return groups;
}

function findTargetMatches(blocks, targets) {
  return Object.fromEntries(targets.map((target) => [
    target,
    blocks.filter((block) => block.serverNames.includes(target))
  ]));
}

function renderGroup(group) {
  return {
    serverName: group.serverName,
    listen: group.listen,
    count: group.blocks.length,
    blocks: group.blocks.map(renderBlock)
  };
}

function renderBlock(block) {
  return {
    file: block.file,
    listen: block.listen,
    serverNames: block.serverNames,
    roots: block.roots,
    proxyPasses: block.proxyPasses,
    containsMedicalCredit: block.containsMedicalCredit,
    containsHearUs: block.containsHearUs
  };
}

function normalizeTargetNames(targetServerNames = DEFAULT_TARGET_NAMES) {
  const values = Array.isArray(targetServerNames)
    ? targetServerNames
    : String(targetServerNames).split(',');
  return unique(values.map((name) => String(name).trim()).filter(Boolean));
}

function normalizeListen(value = '') {
  const clean = String(value).replace(/\s+default_server\b/i, '').trim();
  const portMatch = clean.match(/(?::|\b)(\d{2,5})\b/);
  return portMatch ? portMatch[1] : clean || '80';
}

function stripInlineComment(line) {
  return String(line).replace(/\s+#.*$/, '');
}

function countChar(text, char) {
  return (String(text).match(new RegExp(`\\${char}`, 'g')) || []).length;
}

function buildRecommendations(decision) {
  if (decision === 'blocked') {
    return [
      '暂停切换 medical-credit 入口。',
      '请 IT 提供独立备案子域名，例如 credit.xxx.com，或明确不会与现有项目冲突的 server_name。',
      '不要修改 hear-us 等既有业务 vhost；先新增独立 medical-credit vhost 并重新运行本闸门。'
    ];
  }

  if (decision === 'manual_review') {
    return [
      '由 IT 确认目标入口归属。',
      '补齐独立 vhost 后重新执行 nginx -T 与本闸门。',
      '确认无冲突后再启动 medical-credit API 容器和 Nginx /api 代理。'
    ];
  }

  return [
    '可以继续执行 PR23 preflight。',
    '切换前仍需 nginx -t 通过，并确认 RDS / OSS / .env 已配置。',
    '先保持 dual_write 灰度，验收通过后再切 aliyun。'
  ];
}

function formatTargetMatches(targetMatches = {}) {
  const lines = [];
  for (const [target, matches] of Object.entries(targetMatches)) {
    lines.push(`### ${target}`);
    if (!matches.length) {
      lines.push('');
      lines.push('- 未命中。');
      lines.push('');
      continue;
    }
    for (const block of matches) {
      lines.push(`- ${block.file || 'unknown file'}；listen=${block.listen.join(', ')}；medical-credit=${block.containsMedicalCredit ? 'yes' : 'no'}；hear-us=${block.containsHearUs ? 'yes' : 'no'}`);
    }
    lines.push('');
  }
  return lines.length ? lines : ['- 未配置目标入口。'];
}

function formatConflicts(conflicts = []) {
  if (!conflicts.length) return ['- 未发现重复 server_name + listen 组合。'];
  return conflicts.flatMap((conflict) => [
    `### ${conflict.serverName} / ${conflict.listen}`,
    '',
    ...conflict.blocks.map((block) => `- ${block.file || 'unknown file'}；root=${block.roots.join(', ') || '-'}；proxy=${block.proxyPasses.join(', ') || '-'}；medical-credit=${block.containsMedicalCredit ? 'yes' : 'no'}；hear-us=${block.containsHearUs ? 'yes' : 'no'}`),
    ''
  ]);
}

function formatList(items = [], emptyText) {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const inputFile = process.env.NGINX_DUMP_FILE || process.argv[2];
  const targetServerNames = process.env.NGINX_TARGET_SERVER_NAMES || process.argv[3] || DEFAULT_TARGET_NAMES;
  const outputFile = process.env.NGINX_GATE_OUTPUT_FILE;
  const markdownOutputFile = process.env.NGINX_GATE_MARKDOWN_FILE;
  const stdinText = inputFile ? '' : await readStdin();
  const gate = await readAndEvaluateNginxEntryGate({
    inputFile,
    targetServerNames,
    outputFile,
    markdownOutputFile,
    stdinText
  });
  console.log(JSON.stringify(gate, null, 2));
  if (gate.decision === 'blocked') {
    process.exit(1);
  }
}
