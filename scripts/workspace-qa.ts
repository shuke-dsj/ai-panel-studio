import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const base = process.env.QA_URL ?? 'http://127.0.0.1:5274';
const b = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await b.newPage({
    viewport: { width: 1568, height: 1003 },
    reducedMotion: 'reduce',
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByLabel('专家人数').selectOption('6');
  await page.screenshot({ path: 'docs/evidence/workspace-new.png' });
  await page.getByLabel('讨论话题').fill('小团队的 RAG 试点评审');
  await page.getByRole('button', { name: '创建讨论组' }).click();
  await page.getByRole('button', { name: '确认并开始讨论' }).waitFor();
  const id = page.url().split('/').at(-1)!;
  await page.locator('[data-role=expert]').nth(0).click();
  await page.locator('[data-role=expert]').nth(2).click();
  await page.screenshot({ path: 'docs/evidence/workspace-roster.png' });
  await page.getByRole('button', { name: '确认并开始讨论' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.result-body article') &&
      document.querySelector('[data-state=speaking]') &&
      document.querySelector('[data-state=preparing]'),
    { timeout: 30000 },
  );
  await page.screenshot({ path: 'docs/evidence/workspace-desktop.png' });
  const desktop = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    body: [document.body.scrollWidth, document.body.scrollHeight],
    states: [...document.querySelectorAll('[data-testid=guest-node]')].map((e) => ({
      state: e.getAttribute('data-state'),
      color: getComputedStyle(e).getPropertyValue('--guest').trim(),
      avatarOpacity: getComputedStyle(e.querySelector('.guest-avatar')!).opacity,
      glow: getComputedStyle(e.querySelector('.guest-avatar')!).boxShadow,
    })),
    inspectors: document.querySelectorAll('.guest-inspector').length,
    areas: ['.conversation-list', '.workspace-content', '.outcomes-list', '.closing-summary'].map(
      (selector) => {
        const e = document.querySelector(selector)!;
        return {
          selector,
          overflow: getComputedStyle(e).overflowY,
          width: e.clientWidth,
          height: e.clientHeight,
        };
      },
    ),
    fonts: [
      '.workspace-heading h1',
      '.guest-inspector h2',
      '.inspector-scroll',
      '.guest-label>strong',
      '.result-body article',
      '.workspace-composer textarea',
    ].map((selector) => {
      const e = document.querySelector(selector);
      return { selector, size: e ? getComputedStyle(e).fontSize : null };
    }),
  }));
  await page.request.post(`${base}/api/discussions/${id}/pause`, { data: {} });
  await page.getByRole('button', { name: '继续讨论', exact: true }).waitFor();
  while (await page.locator('.guest-inspector .icon-button').count())
    await page.locator('.guest-inspector .icon-button').first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/evidence/workspace-mobile.png' });
  await page.locator('[data-role=expert]').nth(0).click();
  await page.screenshot({ path: 'docs/evidence/workspace-mobile-inspector.png' });
  const mobile = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    body: [document.body.scrollWidth, document.body.scrollHeight],
    composerVisible:
      document.querySelector('.workspace-composer')!.getBoundingClientRect().bottom <= innerHeight,
  }));
  await page.getByRole('button', { name: '打开讨论成果' }).click();
  await page.screenshot({ path: 'docs/evidence/workspace-mobile-results.png' });
  writeFileSync(
    'docs/evidence/workspace-layout.json',
    JSON.stringify({ testedAt: new Date().toISOString(), id, desktop, mobile, errors }, null, 2),
  );
  console.info(JSON.stringify({ id, desktop, mobile, errors }));
} finally {
  await b.close();
}
