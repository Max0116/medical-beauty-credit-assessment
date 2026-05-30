import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_BUCKET = 'medical-credit-verification-evidence';
const DEFAULT_REGION = 'oss-cn-shanghai';
const DEFAULT_PREFIX = 'verification-evidence/';
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const REGION_PATTERN = /^oss-[a-z0-9-]+$/;
const OBJECT_PREFIX_PATTERN = /^[A-Za-z0-9/_-]+\/$/;

const OBJECT_ACTIONS = [
  'oss:PutObject',
  'oss:GetObject',
  'oss:GetObjectMeta',
  'oss:HeadObject'
];
const BUCKET_ACTIONS = [
  'oss:GetBucketInfo'
];

export function evaluateOssPolicyConfig({
  bucket = DEFAULT_BUCKET,
  region = DEFAULT_REGION,
  prefix = DEFAULT_PREFIX
} = {}) {
  const normalizedBucket = String(bucket || '').trim();
  const normalizedRegion = String(region || '').trim();
  const normalizedPrefix = normalizePrefix(prefix);
  const blockers = [];
  const warnings = [];

  if (!normalizedBucket) blockers.push('OSS bucket is required.');
  else if (!BUCKET_PATTERN.test(normalizedBucket)) blockers.push(`OSS bucket name is invalid: ${normalizedBucket}`);
  if (!normalizedRegion) blockers.push('OSS region is required.');
  else if (!REGION_PATTERN.test(normalizedRegion)) blockers.push(`OSS region is invalid: ${normalizedRegion}`);
  if (!normalizedPrefix) blockers.push('OSS object prefix is required.');
  else if (!OBJECT_PREFIX_PATTERN.test(normalizedPrefix)) blockers.push(`OSS object prefix must contain only letters, numbers, slash, underscore, and hyphen, and end with /: ${normalizedPrefix}`);

  if (normalizedBucket !== DEFAULT_BUCKET) {
    warnings.push(`Bucket name differs from the PR23 default ${DEFAULT_BUCKET}; confirm it is a dedicated private bucket.`);
  }
  if (normalizedPrefix !== DEFAULT_PREFIX) {
    warnings.push(`Object prefix differs from the application default ${DEFAULT_PREFIX}; confirm aliyun-api/ossStorage.js is updated before changing it.`);
  }

  const decision = blockers.length ? 'blocked' : warnings.length ? 'manual_review' : 'go';
  return {
    ok: decision === 'go',
    decision,
    bucket: normalizedBucket,
    region: normalizedRegion,
    prefix: normalizedPrefix,
    blockers,
    warnings
  };
}

export function buildOssRamPolicy({
  bucket = DEFAULT_BUCKET,
  prefix = DEFAULT_PREFIX
} = {}) {
  const report = evaluateOssPolicyConfig({ bucket, prefix });
  if (report.decision === 'blocked') {
    throw new Error(`Invalid OSS policy config: ${report.blockers.join('; ')}`);
  }
  return {
    Version: '1',
    Statement: [
      {
        Effect: 'Allow',
        Action: OBJECT_ACTIONS,
        Resource: [
          `acs:oss:*:*:${report.bucket}/${report.prefix}*`
        ]
      },
      {
        Effect: 'Allow',
        Action: BUCKET_ACTIONS,
        Resource: [
          `acs:oss:*:*:${report.bucket}`
        ]
      }
    ]
  };
}

export function renderOssSetupMarkdown({
  bucket = DEFAULT_BUCKET,
  region = DEFAULT_REGION,
  prefix = DEFAULT_PREFIX,
  policyName = 'medical-credit-verification-evidence-policy',
  generatedAt = new Date().toISOString()
} = {}) {
  const report = evaluateOssPolicyConfig({ bucket, region, prefix });
  if (report.decision === 'blocked') {
    throw new Error(`Invalid OSS setup config: ${report.blockers.join('; ')}`);
  }
  const policy = buildOssRamPolicy(report);
  return [
    '# PR23 阿里云 OSS / RAM 最小权限配置',
    '',
    `生成时间：${generatedAt}`,
    `Bucket：${report.bucket}`,
    `Region：${report.region}`,
    `对象前缀：${report.prefix}`,
    `RAM Policy 名称建议：${policyName}`,
    '',
    '## 控制台操作清单',
    '',
    '1. 创建独立 OSS bucket，名称使用上方 Bucket。',
    '2. Bucket 权限保持私有，不开启公共读写。',
    '3. 创建或选择 RAM 子账号 / AccessKey，仅用于 medical-credit-assessment API。',
    '4. 将下方 RAM Policy 绑定到该 RAM 身份。',
    '5. 将 AccessKey 只写入 API `.env`，不要放入 H5 根目录、Git、截图或聊天记录。',
    '6. API `.env` 配置完成后运行 `npm run resources:aliyun:check` 和 `npm run health:aliyun`。',
    '',
    '## RAM Policy JSON',
    '',
    '```json',
    JSON.stringify(policy, null, 2),
    '```',
    '',
    '## 复核点',
    '',
    '- Policy 只允许目标 bucket 的 `verification-evidence/` 前缀对象读写。',
    '- Policy 不包含 `oss:DeleteObject`、`oss:ListBuckets` 或其他全局权限。',
    '- Bucket 不是公司其他项目共用 bucket。',
    '- AccessKey 只在服务端使用。',
    ''
  ].join('\n');
}

export async function runOssPolicyGenerator({
  policyOutputFile,
  markdownOutputFile,
  writeFileImpl = writeFile,
  options = {}
} = {}) {
  const report = evaluateOssPolicyConfig(options);
  if (report.decision === 'blocked') return { report, policy: null, markdown: '' };
  const policy = buildOssRamPolicy(report);
  const markdown = renderOssSetupMarkdown({ ...report, policyName: options.policyName });

  if (policyOutputFile) {
    await writeFileImpl(policyOutputFile, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  }
  if (markdownOutputFile) {
    await writeFileImpl(markdownOutputFile, markdown, { mode: 0o600 });
  }
  return {
    report,
    policy: policyOutputFile ? null : policy,
    markdown: markdownOutputFile ? '' : markdown
  };
}

export function buildOssPolicyOptionsFromEnv(env = process.env) {
  return {
    bucket: env.ALIYUN_OSS_POLICY_BUCKET || env.ALIYUN_OSS_BUCKET || DEFAULT_BUCKET,
    region: env.ALIYUN_OSS_POLICY_REGION || env.ALIYUN_OSS_REGION || DEFAULT_REGION,
    prefix: env.ALIYUN_OSS_POLICY_PREFIX || DEFAULT_PREFIX,
    policyName: env.ALIYUN_OSS_POLICY_NAME || 'medical-credit-verification-evidence-policy'
  };
}

function normalizePrefix(value) {
  const text = String(value || '').trim().replace(/^\/+/, '');
  if (!text) return '';
  return text.endsWith('/') ? text : `${text}/`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const options = buildOssPolicyOptionsFromEnv(process.env);
  const result = await runOssPolicyGenerator({
    policyOutputFile: process.env.ALIYUN_OSS_POLICY_OUTPUT_FILE,
    markdownOutputFile: process.env.ALIYUN_OSS_POLICY_MARKDOWN_FILE,
    options
  });

  if (result.policy) {
    console.log(JSON.stringify(result.policy, null, 2));
  }
  if (result.markdown) {
    process.stdout.write(`${result.markdown}\n`);
  }
  console.log(JSON.stringify({
    ...result.report,
    policyOutputFile: process.env.ALIYUN_OSS_POLICY_OUTPUT_FILE || '',
    markdownOutputFile: process.env.ALIYUN_OSS_POLICY_MARKDOWN_FILE || '',
    secretPrinted: false
  }, null, 2));
  if (result.report.decision === 'blocked') process.exit(1);
}
