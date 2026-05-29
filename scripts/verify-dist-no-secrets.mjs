import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const distDir = new URL('../dist', import.meta.url).pathname;

export const forbiddenDistPatterns = [
  { label: 'Any Supabase project URL', pattern: /https?:\/\/[^"'`\s]*supabase\.co/i },
  { label: 'Supabase Function URL', pattern: /supabase\.co\/functions\/v1\/assessments/i },
  { label: 'Supabase publishable key', pattern: /sb_publishable_[a-z0-9_]+/i },
  { label: 'Supabase service role marker', pattern: /service_role/i },
  { label: 'Zhipu Web Search endpoint', pattern: /open\.bigmodel\.cn\/api\/paas\/v4/i },
  { label: '智谱 API key marker', pattern: /ZHIPUAI_API_KEY/i },
  { label: 'Aliyun OSS AccessKey marker', pattern: /ALIYUN_OSS_ACCESS_KEY/i },
  { label: 'Aliyun RDS password marker', pattern: /ALIYUN_RDS_PASSWORD/i },
  { label: 'Aliyun AccessKey ID marker', pattern: /ACCESS_KEY_ID/i },
  { label: 'Aliyun AccessKey secret marker', pattern: /ACCESS_KEY_SECRET/i },
  { label: 'Aliyun upstream URL marker', pattern: /ASSESSMENT_UPSTREAM_URL/i },
  { label: 'Aliyun upstream API key marker', pattern: /ASSESSMENT_UPSTREAM_API_KEY/i },
  { label: 'Raw upstream secret marker', pattern: /ASSESSMENT_SECRET_KEYS/i }
];

export const requiredDomesticDistPatterns = [
  {
    label: 'Frontend API base is same-origin /api',
    pattern: /VITE_ASSESSMENT_API_URL["']?\s*:\s*["']\/api["']/i
  }
];

export async function verifyDistNoSecrets({
  directory = distDir,
  forbiddenPatterns = forbiddenDistPatterns,
  requiredPatterns = requiredDomesticDistPatterns,
  cwd = process.cwd()
} = {}) {
  const files = await listFiles(directory);
  const findings = [];
  const requiredMatches = new Map(requiredPatterns.map((item) => [item.label, false]));

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    for (const { label, pattern } of forbiddenPatterns) {
      if (pattern.test(content)) {
        findings.push(`${label}: ${relative(cwd, file)}`);
      }
    }
    for (const { label, pattern } of requiredPatterns) {
      if (!requiredMatches.get(label) && pattern.test(content)) {
        requiredMatches.set(label, true);
      }
    }
  }

  const missingRequired = [...requiredMatches.entries()]
    .filter(([, matched]) => !matched)
    .map(([label]) => label);

  return {
    ok: findings.length === 0 && missingRequired.length === 0,
    checkedFiles: files.length,
    findings,
    missingRequired
  };
}

async function listFiles(dir) {
  const dirStat = await stat(dir).catch(() => null);
  if (!dirStat?.isDirectory()) {
    throw new Error('dist directory not found. Run npm run build first.');
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await listFiles(path));
    } else if (entry.isFile()) {
      result.push(path);
    }
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyDistNoSecrets();

  if (!result.ok) {
    if (result.findings.length) {
      console.error('Forbidden backend secret/upstream markers found in dist:');
      for (const finding of result.findings) console.error(`- ${finding}`);
    }
    if (result.missingRequired.length) {
      console.error('Required Aliyun domestic build markers were not found in dist:');
      for (const label of result.missingRequired) console.error(`- ${label}`);
    }
    process.exit(1);
  }

  console.log(`dist secret/domestic route scan passed (${result.checkedFiles} files checked).`);
}
