import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const base = process.env.QA_URL ?? 'http://127.0.0.1:3001';
const reference = readFileSync('docs/design/studio-concept.png');
const width = reference.readUInt32BE(16),
  height = reference.readUInt32BE(20);
mkdirSync('docs/evidence', { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('heading', { name: '所有讨论' }).waitFor();
  await page.locator('.discussion-row').first().waitFor();
  await page.screenshot({ path: 'docs/evidence/home-desktop.png' });
  await page
    .locator('.discussion-row')
    .filter({ hasText: '企业知识库是否应优先引入 RAG？' })
    .filter({ hasText: '人工编写示例' })
    .click();
  await page.locator('.transcript-message').first().waitFor();
  await page.locator('.transcript-scroll').evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: 'docs/evidence/studio-desktop.png' });
  const desktop = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    body: [document.body.scrollWidth, document.body.scrollHeight],
    headerTop: document.querySelector('.brand-header')?.getBoundingClientRect().top,
    panels: [...document.querySelectorAll('.panel-scroll')].map((e) => ({
      client: e.clientHeight,
      scroll: e.scrollHeight,
      overflow: getComputedStyle(e).overflowY,
    })),
    fonts: [
      '.brand',
      '.topic-identity h1',
      '.panel-heading h2',
      '.message-text',
      '.button',
      '.public-focus',
    ].map((selector) => {
      const el = document.querySelector(selector);
      return { selector, fontSize: el ? getComputedStyle(el).fontSize : null };
    }),
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '现场讨论', exact: true }).click();
  await page.screenshot({ path: 'docs/evidence/studio-mobile.png' });
  await page.getByRole('button', { name: '讨论成果', exact: true }).click();
  await page.screenshot({ path: 'docs/evidence/insights-mobile.png' });
  const mobile = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    body: [document.body.scrollWidth, document.body.scrollHeight],
    activePanel: [...document.querySelectorAll('.studio-grid .panel')].find(
      (el) => getComputedStyle(el).display !== 'none',
    )?.className,
  }));
  await page.getByRole('link', { name: '所有讨论', exact: true }).click();
  await page.getByRole('button', { name: '发起新讨论' }).click();
  await page.screenshot({ path: 'docs/evidence/create-mobile.png' });
  const health = await (await page.request.get(`${base}/api/health`)).json();
  if (health.mode === 'demo') {
    await page.getByRole('textbox', { name: '讨论话题' }).fill('企业知识库是否应优先引入 RAG？');
    await page.getByRole('button', { name: '生成嘉宾阵容' }).click();
    await page.getByRole('button', { name: '确认并进入演播厅' }).waitFor();
    await page.locator('.roster-card').first().waitFor();
    await page.screenshot({ path: 'docs/evidence/roster-mobile.png' });
    await page.setViewportSize({ width, height });
    if (await page.locator('.brand-header').evaluate((el) => el.getBoundingClientRect().top < 0))
      throw new Error('Header scrolled outside the viewport.');
    await page.screenshot({ path: 'docs/evidence/roster-desktop.png' });
    await page.getByRole('button', { name: '确认并进入演播厅' }).click();
    await page.getByRole('button', { name: '开始讨论' }).click();
    await page.waitForFunction(
      () => Number(document.querySelector('progress')?.getAttribute('value')) >= 4,
    );
    await page.getByText('交叉讨论', { exact: true }).waitFor();
    await page.locator('.transcript-scroll').evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: 'docs/evidence/studio-live-desktop.png' });
    await page.getByRole('button', { name: '暂停讨论' }).click();
    await page.getByRole('button', { name: '继续讨论' }).waitFor();
  }
  writeFileSync(
    'docs/evidence/layout.json',
    JSON.stringify(
      {
        method:
          'Playwright + installed Microsoft Edge. IAB sandbox failure and Edge connector timeout required fallback.',
        referenceViewport: { width, height },
        desktop,
        mobile,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.info(
    JSON.stringify({ referenceViewport: { width, height }, desktop, mobile, pageErrors: errors }),
  );
} finally {
  await browser.close();
}
