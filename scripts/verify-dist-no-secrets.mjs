import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const distDir = new URL('../dist', import.meta.url).pathname;

const forbiddenPatterns = [
  { label: 'Supabase Function URL', pattern: /supabase\.co\/functions\/v1\/assessments/i },
  { label: 'Supabase publishable key', pattern: /sb_publishable_[a-z0-9_]+/i },
  { label: 'Supabase service role marker', pattern: /service_role/i },
  { label: '智谱 API key marker', pattern: /ZHIPUAI_API_KEY/i },
  { label: 'Aliyun upstream API key marker', pattern: /ASSESSMENT_UPSTREAM_API_KEY/i },
  { label: 'Raw upstream secret marker', pattern: /ASSESSMENT_SECRET_KEYS/i }
];

const files = await listFiles(distDir);
const findings = [];

for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) {
      findings.push(`${label}: ${relative(process.cwd(), file)}`);
    }
  }
}

if (findings.length) {
  console.error('Forbidden backend secret/upstream markers found in dist:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`dist secret scan passed (${files.length} files checked).`);

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
