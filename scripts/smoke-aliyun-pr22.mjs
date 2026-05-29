import { chromium } from 'playwright';

const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL || 'http://101.132.137.25');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const expectApi = process.env.SMOKE_EXPECT_API !== 'false';
const fullFlow = process.env.SMOKE_FULL_FLOW === 'true';
const viewport = {
  width: Number(process.env.SMOKE_VIEWPORT_WIDTH || 390),
  height: Number(process.env.SMOKE_VIEWPORT_HEIGHT || 844)
};

const result = {
  baseUrl,
  expectApi,
  fullFlow,
  viewport,
  apiHealth: null,
  page: null,
  fullFlowResult: null,
  consoleErrors: [],
  pageErrors: []
};

if (expectApi) {
  result.apiHealth = await checkApiHealth();
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport,
    isMobile: true,
    deviceScaleFactor: 3
  });

  page.on('console', (message) => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => result.pageErrors.push(error.message));

  const url = `${baseUrl}/?v=pr22-smoke-${Date.now()}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
  await page.waitForTimeout(1000);

  const bodyText = await page.locator('body').innerText({ timeout: timeoutMs });
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1
      && document.body.scrollWidth <= window.innerWidth + 1
  }));

  result.page = {
    url,
    title: await page.title(),
    hasAppTitle: /医美机构账期评估|授信工作台/.test(bodyText),
    metrics
  };

  if (!result.page.hasAppTitle) {
    throw new Error('H5 app title was not found in rendered page.');
  }
  if (!metrics.noHorizontalScroll) {
    throw new Error(`Mobile viewport has horizontal overflow: viewport=${metrics.innerWidth}, document=${metrics.documentScrollWidth}, body=${metrics.bodyScrollWidth}`);
  }

  if (fullFlow) {
    result.fullFlowResult = await runFullFlow(page);
  }
} finally {
  await browser.close();
}

if (result.consoleErrors.length || result.pageErrors.length) {
  throw new Error(`Browser errors detected: ${JSON.stringify({
    consoleErrors: result.consoleErrors,
    pageErrors: result.pageErrors
  })}`);
}

console.log(JSON.stringify(result, null, 2));

async function checkApiHealth() {
  const response = await fetchWithTimeout(`${baseUrl}/api/health`, { timeoutMs });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(`/api/health returned ${response.status}: ${text.slice(0, 240)}`);
  }
  if (!payload?.ok) {
    throw new Error(`/api/health payload is not ok: ${text.slice(0, 240)}`);
  }

  return {
    status: response.status,
    payload
  };
}

async function runFullFlow(page) {
  const apiResponses = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/')) {
      apiResponses.push({ url: url.replace(/\?.*/, ''), status: response.status() });
    }
  });

  const institutionName = `PR22中转验收测试${Date.now()}`;
  const firstInput = page.locator('input').first();
  await firstInput.fill(institutionName);

  const saveButton = page.getByRole('button', { name: /保存并|开始核验|保存/ }).first();
  await saveButton.click();
  await page.waitForTimeout(4000);

  const bodyText = await page.locator('body').innerText({ timeout: timeoutMs });
  const hasRemoteEvidence = /远端|同步|核验|公共风险核验|后台/.test(bodyText);
  const hasRecordsCall = apiResponses.some((item) => item.url.includes('/api/records') && item.status < 500);

  if (!hasRecordsCall) {
    throw new Error(`Full flow did not observe a successful /api/records call: ${JSON.stringify(apiResponses)}`);
  }

  return {
    institutionName,
    hasRemoteEvidence,
    hasRecordsCall,
    apiResponses
  };
}

async function fetchWithTimeout(url, { timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}
