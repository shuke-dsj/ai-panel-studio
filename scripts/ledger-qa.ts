import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const id = process.env.QA_DISCUSSION_ID ?? 'e950f15d-2229-456a-bf2d-cf3a2194ba06';
const prefix = process.env.QA_PREFIX ?? 'ledger';
try {
  const page = await b.newPage({
    viewport: { width: 1568, height: 1003 },
    reducedMotion: 'reduce',
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:5173/#/discussion/${id}`);
  const closed = page
    .locator('details.result-section')
    .filter({ has: page.locator('strong').filter({ hasText: /^已关闭分歧/ }) });
  await closed.locator(':scope > summary').waitFor();
  await closed.locator(':scope > summary').click();
  await closed.getByText('查看关闭依据', { exact: true }).first().click();
  await closed.locator('blockquote').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `docs/evidence/${prefix}-desktop.png` });
  const desktop = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
  }));
  const text = await closed.innerText();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开讨论成果' }).click();
  await closed.locator('blockquote').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `docs/evidence/${prefix}-mobile.png` });
  const mobile = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
  }));
  const passed =
    errors.length === 0 &&
    [desktop, mobile].every((x) => x.bodyWidth <= x.width && x.bodyHeight <= x.height);
  writeFileSync(
    `docs/evidence/${prefix}-layout.json`,
    JSON.stringify(
      { testedAt: new Date().toISOString(), desktop, mobile, errors, closedText: text, passed },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ desktop, mobile, errors, passed }));
  if (!passed) process.exitCode = 1;
} finally {
  await b.close();
}
