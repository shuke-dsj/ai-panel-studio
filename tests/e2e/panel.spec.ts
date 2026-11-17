import { test, expect, type APIRequestContext } from '@playwright/test';
async function create(request: APIRequestContext, topic: string, experts = 4, maxTurns = 48) {
  const response = await request.post('/api/discussions', {
    data: { topic, expertCount: experts, maxTurns },
  });
  expect(response.ok()).toBe(true);
  const d = await response.json();
  expect((await request.post(`/api/discussions/${d.id}/roster`, { data: {} })).ok()).toBe(true);
  expect((await request.post(`/api/discussions/${d.id}/confirm`, { data: {} })).ok()).toBe(true);
  return d.id as string;
}

test('dynamic preview, generated profiles, confirmation and independent windows', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '新建圆桌讨论' })).toBeVisible();
  await page.getByLabel('讨论话题').fill('尚未发送的草稿');
  await page.getByRole('link', { name: '新建讨论组', exact: true }).click();
  await expect(page.getByLabel('讨论话题')).toHaveValue('');
  for (const n of [2, 6, 4]) {
    await page.getByLabel('专家人数').selectOption(String(n));
    await expect(page.getByTestId('guest-node')).toHaveCount(n + 1);
    await expect(page.locator('[data-role=moderator]')).toHaveCount(1);
  }
  await page.getByLabel('讨论话题').fill('E2E工作区：如何验证离线知识检索的价值？');
  await page.getByRole('button', { name: '创建讨论组' }).click();
  await expect(page.getByRole('button', { name: '确认并开始讨论' })).toBeEnabled();
  const id = page.url().split('/').at(-1)!;
  const snapshot = await (await request.get(`/api/discussions/${id}`)).json();
  expect(snapshot.discussion.status).toBe('roster_ready');
  expect(snapshot.discussion.maxTurns).toBe(48);
  expect(snapshot.messages).toHaveLength(0);
  for (const p of snapshot.participants) {
    await page
      .getByRole('button', { name: `${p.name} · ${p.occupation} · 待机`, exact: true })
      .click();
    const inspector = page.getByRole('region', { name: `${p.name}的独立窗口` });
    await expect(inspector).toContainText(p.title);
    await expect(inspector).toContainText(p.stance);
    await expect(inspector).toContainText('当前关注点');
  }
  await expect(page.locator('.guest-inspector')).toHaveCount(5);
  await page.getByRole('button', { name: `关闭${snapshot.participants[0].name}窗口` }).click();
  await expect(page.locator('.guest-inspector')).toHaveCount(4);
  await page.getByRole('button', { name: '重新生成阵容' }).click();
  await expect(page.getByRole('button', { name: '确认并开始讨论' })).toBeEnabled();
  await page.getByRole('button', { name: '确认并开始讨论' }).click();
  await expect(page.getByRole('button', { name: '暂停讨论', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停讨论', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续讨论', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '新建讨论组', exact: true })).toBeVisible();
});

test('live steering, pause, reconnect, autonomous convergence beyond six, summary and reopen', async ({
  page,
  request,
  context,
}) => {
  const id = await create(request, 'E2E实时：仅非敏感、只读的2周验证');
  await request.post(`/api/discussions/${id}/start`, { data: {} });
  await page.goto(`/#/discussion/${id}`);
  await expect(page.locator('[data-state=speaking]')).toHaveCount(1);
  await page.getByLabel('调整讨论方向').fill('重点补充人工回退与退出条件，原有范围不变。');
  await page.getByRole('button', { name: '发送讨论调整' }).click();
  await expect(page.locator('.current-focus')).toContainText('人工回退');
  await page.getByRole('button', { name: '暂停讨论', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续讨论', exact: true })).toBeVisible();
  const paused = await (await request.get(`/api/discussions/${id}`)).json();
  await page.waitForTimeout(400);
  const later = await (await request.get(`/api/discussions/${id}`)).json();
  expect(later.messages.map((m: any) => m.id)).toEqual(paused.messages.map((m: any) => m.id));
  await page.getByRole('button', { name: '继续讨论', exact: true }).click();
  await context.setOffline(true);
  await page.waitForTimeout(250);
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.workspace-heading')).toContainText('已结束', { timeout: 45000 });
  const completed = await (await request.get(`/api/discussions/${id}`)).json();
  expect(completed.discussion.turns).toBeGreaterThan(6);
  expect(completed.discussion.turns).toBeLessThan(48);
  expect(completed.discussion.endReason).toBe('stable_disagreement');
  await expect(page.getByTestId('final-summary')).toContainText('本轮');
  await page.getByText('查看完整依据与条件', { exact: true }).click();
  await expect(page.getByTestId('final-summary')).toContainText('关键条件与阶段安排');
  await page.getByRole('button', { name: /^现场记录（/ }).click();
  await expect(page.locator('.transcript-message')).toHaveCount(completed.messages.length);
  await expect(page.locator('.transcript-message')).toContainText(['重点补充人工回退']);
  expect(new Set(await page.locator('.message-number').allTextContents()).size).toBe(
    completed.messages.length,
  );
  await page.getByRole('link', { name: '新建讨论组', exact: true }).click();
  await page.goto(`/#/discussion/${id}`);
  await expect(page.getByTestId('final-summary')).toContainText(completed.discussion.summary);
  const layout = await page
    .locator('body')
    .evaluate((e) => e.scrollHeight <= innerHeight && e.scrollWidth <= innerWidth);
  expect(layout).toBe(true);
});

test('replace premises during pause, archive and start another bounded cycle', async ({
  page,
  request,
}) => {
  const id = await create(request, 'E2E前提：旧的2周检索试点', 2, 6);
  await request.post(`/api/discussions/${id}/start`, { data: {} });
  await page.goto(`/#/discussion/${id}`);
  await page.getByRole('button', { name: '暂停讨论', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续讨论', exact: true })).toBeVisible();
  await page.getByLabel('更新前提', { exact: true }).check();
  await page.getByLabel('调整讨论方向').fill('改为本地离线搜索评审，不再采用原试点前提。');
  await page.getByRole('button', { name: '发送讨论调整' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('本地离线搜索');
  await page.getByRole('button', { name: '继续讨论', exact: true }).click();
  await expect(page.locator('.workspace-heading')).toContainText('已结束', { timeout: 30000 });
  await page.getByLabel('调整焦点', { exact: true }).check();
  await page.getByLabel('调整讨论方向').fill('进一步评审维护成本。');
  await page.getByRole('button', { name: '开始新一轮' }).click();
  await expect(page.locator('.workspace-heading')).toContainText('已结束', { timeout: 30000 });
  const result = await (await request.get(`/api/discussions/${id}`)).json();
  expect(result.discussion.cycle).toBe(2);
  expect(result.discussion.summaryHistory).toHaveLength(1);
  expect(result.discussion.previousContexts).toHaveLength(1);
  await expect(page.getByTestId('final-summary')).toContainText('历史轮次总结');
  await page.locator('.archived-contexts > summary').click();
  await expect(page.locator('.archived-contexts')).toContainText('旧的2周检索试点');
});

test('switch and create groups during another discussion; end independently', async ({
  page,
  request,
}) => {
  const a = await create(request, 'E2E并发A：成本', 2),
    b = await create(request, 'E2E并发B：权限', 2);
  await request.post(`/api/discussions/${a}/start`, { data: {} });
  await request.post(`/api/discussions/${b}/start`, { data: {} });
  await page.goto(`/#/discussion/${a}`);
  await page.getByRole('link', { name: '新建讨论组', exact: true }).click();
  await expect(page.getByLabel('讨论话题')).toBeVisible();
  await page.locator(`.conversation-row[href="#/discussion/${b}"]`).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E并发B：权限');
  await page.getByRole('button', { name: '结束讨论', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(page.locator('.workspace-heading')).toContainText('已结束');
  const sa = await (await request.get(`/api/discussions/${a}`)).json(),
    sb = await (await request.get(`/api/discussions/${b}`)).json();
  expect(sa.messages.every((m: any) => m.discussionId === a)).toBe(true);
  expect(sb.messages.every((m: any) => m.discussionId === b)).toBe(true);
  expect(sb.discussion.turns).toBeLessThan(48);
  await request.post(`/api/discussions/${a}/end`, { data: {} });
});

test('collapsible outcomes, evidence navigation and mobile independent surfaces', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('搜索讨论').fill('企业知识库');
  await page
    .locator('.conversation-row')
    .filter({ hasText: '企业知识库是否应优先引入 RAG？' })
    .click();
  await expect(page.locator('.workspace-info')).toContainText('人工编写示例');
  const consensus = page.locator('details.consensus');
  await consensus.locator(':scope > summary').click();
  await expect(consensus).not.toHaveAttribute('open');
  await consensus.locator(':scope > summary').click();
  await consensus.locator('.result-references button').first().click();
  await expect(page.locator('.transcript-message.highlighted')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '圆桌现场', exact: true }).click();
  await page.locator('[data-role=expert]').first().click();
  await page.locator('[data-role=expert]').last().click();
  await expect(page.locator('.guest-inspector')).toHaveCount(2);
  await page.locator('.workspace-content').evaluate((e) => {
    e.scrollTop = 0;
  });
  await expect(page.locator('.guest-inspector').first()).toBeVisible();
  await page.getByRole('button', { name: '打开讨论成果' }).click();
  await expect(page.getByTestId('final-summary')).toBeVisible();
  await page.getByRole('button', { name: '关闭讨论成果' }).click();
  await page.getByRole('button', { name: '打开讨论组列表' }).click();
  await expect(page.getByRole('link', { name: '新建讨论组', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '新建讨论组', exact: true }).click();
  await expect(page.getByLabel('讨论话题')).toBeVisible();
  await page.getByLabel('专家人数').selectOption('6');
  await expect(page.getByTestId('guest-node')).toHaveCount(7);
  expect(
    await page
      .locator('body')
      .evaluate((e) => e.scrollHeight <= innerHeight && e.scrollWidth <= innerWidth),
  ).toBe(true);
});
