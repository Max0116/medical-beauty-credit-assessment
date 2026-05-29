import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { verifyDistNoSecrets } from './verify-dist-no-secrets.mjs';

describe('verifyDistNoSecrets', () => {
  it('accepts an Aliyun domestic build that only points the frontend to /api', async () => {
    const dir = await createDistFixture({
      'index.html': '<div id="root"></div>',
      'assets/index.js': 'const env={VITE_ASSESSMENT_API_URL:"/api",VITE_ASSESSMENT_API_KEY:""};'
    });

    await expect(verifyDistNoSecrets({ directory: dir, cwd: dir })).resolves.toMatchObject({
      ok: true,
      checkedFiles: 2,
      findings: [],
      missingRequired: []
    });
  });

  it('blocks direct Supabase, Zhipu, and Aliyun secret markers from browser-visible files', async () => {
    const dir = await createDistFixture({
      'index.html': '<script type="module" src="/assets/index.js"></script>',
      'assets/index.js': [
        'const env={VITE_ASSESSMENT_API_URL:"/api"};',
        'fetch("https://demo.supabase.co/functions/v1/assessments");',
        'fetch("https://open.bigmodel.cn/api/paas/v4/web_search");',
        'const keyName="ALIYUN_OSS_ACCESS_KEY_SECRET";'
      ].join('\n')
    });

    await expect(verifyDistNoSecrets({ directory: dir, cwd: dir })).resolves.toMatchObject({
      ok: false,
      findings: [
        'Any Supabase project URL: assets/index.js',
        'Supabase Function URL: assets/index.js',
        'Zhipu Web Search endpoint: assets/index.js',
        'Aliyun OSS AccessKey marker: assets/index.js',
        'Aliyun AccessKey secret marker: assets/index.js'
      ],
      missingRequired: []
    });
  });

  it('fails when the Aliyun release build does not contain same-origin /api config', async () => {
    const dir = await createDistFixture({
      'index.html': '<div id="root"></div>',
      'assets/index.js': 'const env={VITE_ASSESSMENT_API_URL:""};'
    });

    await expect(verifyDistNoSecrets({ directory: dir, cwd: dir })).resolves.toMatchObject({
      ok: false,
      findings: [],
      missingRequired: ['Frontend API base is same-origin /api']
    });
  });
});

async function createDistFixture(files) {
  const dir = join(tmpdir(), `medical-credit-dist-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(dir, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  return dir;
}
