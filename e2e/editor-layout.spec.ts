import { test, expect, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { newQuestion } from '../apps/web/src/question-editor.js';

test('editor follows parent order and keeps controls aligned across screen sizes', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill('LocalStudy2026!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await expect(page.getByRole('button', { name: '+ New assignment', exact: true })).toBeVisible();
  const classes = await (await page.request.get('/api/classes')).json();
  const roots = Array.from({ length: 11 }, (_, i) =>
    newQuestion(i === 7 || i === 8 ? 'COMPOSITE' : 'SINGLE_CHOICE', null, i),
  );
  const child8 = newQuestion('SINGLE_CHOICE', roots[7]!.id, 0);
  const child82 = newQuestion('SINGLE_CHOICE', roots[7]!.id, 1);
  const child9 = newQuestion('SINGLE_CHOICE', roots[8]!.id, 0);
  const response = await page.request.post('/api/assignments', {
    headers: { Origin: 'http://127.0.0.1:5175' },
    data: {
      schemaVersion: 2,
      classId: classes[0].id,
      title: `Editor layout ${randomUUID()}`,
      description: '',
      dueAt: '2035-10-01T12:00:00Z',
      questions: [roots[0], child9, child8, child82, ...roots.slice(1)],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const assignment = await response.json();
  await page.goto(`/assignments/${assignment.id}/edit`);
  await page.getByText('Points by question', { exact: true }).click();
  const directory = page.locator('.score-directory li button > span');
  await expect(directory).toHaveText([
    'Question 1',
    'Question 2',
    'Question 3',
    'Question 4',
    'Question 5',
    'Question 6',
    'Question 7',
    'Question 8.1',
    'Question 8.2',
    'Question 9.1',
    'Question 10',
    'Question 11',
  ]);
  await page.getByLabel('Place question in').first().click();
  await expect(page.getByRole('option')).toHaveText(['Top level', 'Group 8', 'Group 9']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Move question 9 up', exact: true }).click();
  await expect(directory).toHaveText([
    'Question 1',
    'Question 2',
    'Question 3',
    'Question 4',
    'Question 5',
    'Question 6',
    'Question 7',
    'Question 8.1',
    'Question 9.1',
    'Question 9.2',
    'Question 10',
    'Question 11',
  ]);
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/assignments/${assignment.id}`) && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save and keep editing', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await page.getByText('Points by question', { exact: true }).click();
  await expect(directory.nth(7)).toHaveText('Question 8.1');
  await expect(directory.nth(9)).toHaveText('Question 9.2');
  await page.getByRole('button', { name: 'Copy question 8', exact: true }).click();
  await expect(directory.last()).toHaveText('Question 12.1');
  await page.getByRole('button', { name: 'Check for publication', exact: true }).click();
  const issueOrder = await page
    .locator('.review-issue-group > summary')
    .evaluateAll((summaries) =>
      summaries.map((summary) => summary.firstChild?.textContent?.trim()),
    );
  expect(issueOrder.indexOf('Question 8.1')).toBeLessThan(issueOrder.indexOf('Question 9.1'));
  expect(issueOrder.indexOf('Question 9.2')).toBeLessThan(issueOrder.indexOf('Question 10'));

  const bottom = (locator: Locator) => locator.evaluate((el) => el.getBoundingClientRect().bottom);
  for (const width of [1440, 1280, 1024, 768, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width >= 768) {
      const canvas = await page.locator('.editor-mode').boundingBox();
      expect(canvas!.x).toBeLessThanOrEqual(212);
    }
    const addRow = page.locator('.authoring-canvas > .inline-actions').first();
    const select = addRow.getByRole('combobox');
    const button = addRow.getByRole('button');
    expect(Math.abs((await bottom(select)) - (await bottom(button)))).toBeLessThanOrEqual(1);
    const actions = page.locator('.choice-actions').first();
    const up = actions.getByRole('button').nth(0);
    const down = actions.getByRole('button').nth(1);
    expect(Math.abs((await bottom(up)) - (await bottom(down)))).toBeLessThanOrEqual(1);
    if (width === 1440 || width === 390) {
      await page.locator('.form-heading').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/${info.project.name}-editor-${width}.png` });
      await page.locator('.editor-question-header').first().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/${info.project.name}-editor-controls-${width}.png`,
      });
    }
  }
});
