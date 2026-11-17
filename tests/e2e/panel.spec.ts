import { test, expect } from '@playwright/test';
test('complete creation, roster, pause, resume, reconnect, summary and reopen', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '所有讨论' })).toBeVisible();
  await page.getByRole('button', { name: '发起新讨论' }).click();
  await page.getByRole('textbox', { name: '讨论话题' }).fill('E2E：小团队如何验证 AI 客服价值？');
  await page.getByLabel('专家发言上限').selectOption('6');
  await page.getByRole('button', { name: '生成嘉宾阵容' }).click();
  await expect(page.getByRole('button', { name: '确认并进入演播厅' })).toBeEnabled();
  await expect(page.locator('.roster-card')).toHaveCount(5);
  expect(await page.locator('.brand-header').evaluate((el) => el.getBoundingClientRect().top)).toBe(
    0,
  );
  await page.getByRole('button', { name: '重新生成阵容' }).click();
  await expect(page.getByRole('button', { name: '确认并进入演播厅' })).toBeEnabled();
  await page.getByRole('button', { name: '确认并进入演播厅' }).click();
  await page.getByRole('button', { name: '开始讨论' }).click();
  await expect(page.locator('.transcript-message')).toHaveCount(1);
  await page.getByRole('button', { name: '暂停讨论' }).click();
  await expect(page.getByRole('button', { name: '继续讨论' })).toBeVisible();
  const pausedCount = await page.locator('.transcript-message').count();
  await page.waitForTimeout(400);
  expect(await page.locator('.transcript-message').count()).toBe(pausedCount);
  await page.getByRole('button', { name: '继续讨论' }).click();
  await expect.poll(() => page.locator('.transcript-message').count()).toBeGreaterThan(pausedCount);
  // Reconnect with a persisted snapshot and ordered event replay.
  await context.setOffline(true);
  await page.waitForTimeout(250);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByTestId('final-summary')).toBeVisible();
  await expect(page.locator('.topic-subtitle .status-label')).toContainText('已结束');
  expect(await page.locator('.message-number').allTextContents()).toEqual(
    Array.from({ length: 9 }, (_, i) => `#${i + 1}`),
  );
  const url = page.url();
  await page.getByRole('link', { name: '所有讨论', exact: true }).click();
  await expect(
    page.getByRole('link').filter({ hasText: 'E2E：小团队如何验证 AI 客服价值？' }).first(),
  ).toBeVisible();
  await page.goto(url);
  await expect(page.getByTestId('final-summary')).toBeVisible();
  expect(await page.locator('body').evaluate((e) => e.scrollHeight <= window.innerHeight)).toBe(
    true,
  );
});
test('early end and two independent simultaneous discussions', async ({ page, request }) => {
  const ids: string[] = [];
  for (const topic of ['并发 A：成本边界', '并发 B：权限边界']) {
    const result = await request.post('/api/discussions', {
      data: { topic, expertCount: 2, maxTurns: 20 },
    });
    const { id } = await result.json();
    ids.push(id);
    await request.post(`/api/discussions/${id}/roster`, { data: {} });
    await request.post(`/api/discussions/${id}/confirm`, { data: {} });
    await request.post(`/api/discussions/${id}/start`, { data: {} });
  }
  await page.goto(`/#/discussion/${ids[0]}`);
  await page.getByRole('button', { name: '提前结束' }).click();
  await expect(page.getByTestId('final-summary')).toBeVisible();
  const a = await (await request.get(`/api/discussions/${ids[0]}`)).json();
  const b = await (await request.get(`/api/discussions/${ids[1]}`)).json();
  expect(a.discussion.turns).toBeLessThan(20);
  expect(a.messages.every((m: any) => m.discussionId === ids[0])).toBe(true);
  expect(b.messages.every((m: any) => m.discussionId === ids[1])).toBe(true);
  expect(a.participants.every((p: any) => !b.participants.some((q: any) => p.id === q.id))).toBe(
    true,
  );
  await request.post(`/api/discussions/${ids[1]}/end`, { data: {} });
});
test('curated examples, evidence navigation, search and mobile layout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '搜索讨论' }).fill('企业知识库');
  await page.getByRole('link').filter({ hasText: '企业知识库是否应优先引入 RAG？' }).click();
  await expect(
    page.getByText('人工编写示例 · 用于展示讨论结构，不代表真实模型运行结果。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '查看第 2 条发言', exact: true }).first().click();
  await expect(page.locator('.highlighted')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '讨论成果', exact: true }).click();
  await expect(page.getByTestId('final-summary')).toBeVisible();
  await page.getByRole('button', { name: '嘉宾', exact: true }).click();
  await expect(page.locator('.participants-panel')).toBeVisible();
  await page.getByRole('button', { name: '现场讨论', exact: true }).click();
  await expect(page.locator('.transcript-panel')).toBeVisible();
  await expect(page.locator('.transcript-message .message-title').first()).toBeVisible();
  expect(
    await page
      .locator('body')
      .evaluate((e) => e.scrollWidth <= window.innerWidth && e.scrollHeight <= window.innerHeight),
  ).toBe(true);
  expect(await page.locator('.brand-header').evaluate((el) => el.getBoundingClientRect().top)).toBe(
    0,
  );
});
