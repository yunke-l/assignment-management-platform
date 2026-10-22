import { selectChoice } from './controls.js';
import { test, expect, type Page } from '@playwright/test';
import { newQuestion } from '../apps/web/src/question-editor.js';
import type { Content } from '@amp/contracts';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:5175';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill('LocalStudy2026!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await expect(page.getByRole('button', { name: '+ New assignment', exact: true })).toBeVisible();
}
async function metadata(page: Page) {
  await page.getByLabel('Title', { exact: true }).fill('P1 authoring check');
  await page.getByLabel('Deadline date', { exact: true }).fill('2035-10-01');
  await page.getByLabel('Deadline time', { exact: true }).fill('12:00');
}
const text = (value: string): Content => [
  { id: randomUUID(), type: 'paragraph', children: [{ type: 'text', text: value }] },
];
async function fixture(page: Page, incomplete = false) {
  const classes = await (await page.request.get('/api/classes')).json();
  const q = newQuestion('SINGLE_CHOICE');
  if (q.type !== 'SINGLE_CHOICE') throw new Error('Unexpected type');
  q.prompt = text('Choose the nocturnal animal.');
  q.config.options = q.config.options
    .slice(0, 2)
    .map((o, i) => ({ ...o, content: text(i ? (incomplete ? '' : 'Robin') : 'Owl') }));
  q.answerKey.correctOptionId = q.config.options[0]!.id;
  const title = `P1 ${randomUUID()}`;
  const response = await page.request.post('/api/assignments', {
    headers: { Origin: origin },
    data: {
      schemaVersion: 2,
      classId: classes.find((c: { name: string }) => c.name === 'English · Group A').id,
      title,
      description: '',
      dueAt: '2035-10-01T12:00:00Z',
      questions: [q],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const assignment = await response.json();
  await page.reload();
  await page.getByLabel('Search title').fill(title);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .click();
  return assignment;
}
test('fill answers retain typed newlines and unit scores are the only source of total points', async ({
  page,
}, info) => {
  await login(page);
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await metadata(page);
  await selectChoice(
    page.getByRole('combobox', { name: 'Question type', exact: true }),
    'FILL_BLANK',
  );
  await page.getByRole('button', { name: 'Change type', exact: true }).click();
  await page.getByRole('button', { name: 'Add blank', exact: true }).click();
  await page.getByLabel('Question text', { exact: true }).fill('An owl flies at [blank 1].');
  const accepted = page.getByLabel('Accepted answers for blank 1 (one per line)', { exact: true });
  await accepted.pressSequentially('night');
  await accepted.press('Enter');
  await expect(accepted).toHaveValue('night\n');
  await accepted.pressSequentially('nighttime');
  await expect(accepted).toHaveValue('night\nnighttime');
  await page.getByRole('spinbutton', { name: 'Points', exact: true }).fill('3');
  await expect(page.getByLabel('Total points', { exact: true })).toHaveText('3');
  await expect(page.getByLabel('Assignment total points', { exact: true })).toHaveText('3');
  await page.getByText('Scoring breakdown · 1 unit', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit points for blank 1', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Points', exact: true })).toBeFocused();
  await page
    .getByRole('region', { name: 'Scoring for question 1', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/${info.project.name}-authoring-scoring.png` });
  await expect(page.getByRole('spinbutton', { name: 'Points', exact: true })).toHaveCount(1);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/assignments') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save and keep editing', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.questions[0].answerKey.answers[0].values).toEqual(['night', 'nighttime']);
  expect(result.questions[0].points).toBe(3);
  await selectChoice(
    page.getByRole('combobox', { name: 'Add question type', exact: true }),
    'RESPONSE',
  );
  await page.getByRole('button', { name: 'Add question', exact: true }).click();
  const responseEditor = page.locator('.editor-question').last();
  await responseEditor.getByRole('button', { name: 'Add grading criterion', exact: true }).click();
  await responseEditor.getByRole('spinbutton', { name: 'Points', exact: true }).fill('4');
  await expect(responseEditor.getByLabel('Total points', { exact: true })).toHaveText('4');
  await expect(page.getByLabel('Assignment total points', { exact: true })).toHaveText('7');
  await page.getByText('Points by question', { exact: true }).click();
  await page.getByRole('button', { name: 'Question 1 3 pts', exact: true }).click();
  await expect(
    page.locator('.editor-question').first().locator('[data-question-field="points"]'),
  ).toBeFocused();
});
test('publication checks focus a readable summary and link to the exact invalid option', async ({
  page,
}, info) => {
  await login(page);
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await page.getByRole('button', { name: 'Check for publication', exact: true }).click();
  const summary = page.getByLabel('Publication check results', { exact: true });
  await expect(summary).toBeFocused();
  await summary.getByRole('button', { name: 'Fix first issue ↗', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Title', { exact: true })).toHaveAccessibleDescription(
    'Enter an assignment title.',
  );
  const link = summary.getByRole('button', {
    name: 'Question 1 · Option B: Enter text or add a ready image or audio file.',
    exact: true,
  });
  await expect(link).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-p1-validation-summary.png` });
  await link.click();
  await expect(page.getByLabel('Option B', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Option B', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Option B', { exact: true })).toHaveAccessibleDescription(
    'Enter text or add a ready image or audio file.',
  );
  await expect(page.getByRole('list', { name: 'Option 2 errors', exact: true })).toContainText(
    'Enter text',
  );
  await expect(summary).not.toContainText('config.options');
  await page.getByLabel('Option B', { exact: true }).fill('Robin');
  await expect(page.getByRole('list', { name: 'Option 2 errors', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Option B', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
});
test('review distinguishes local checks from file checks and recovers from check failure', async ({
  page,
}) => {
  await login(page);
  const assignment = await fixture(page);
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const review = page.getByLabel('Publication check results', { exact: true });
  await expect(review).toContainText('Not checked');
  await page.route(`**/api/assignments/${assignment.id}/validate`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Temporarily unavailable. Try again.' }),
    }),
  );
  await review.getByRole('button', { name: 'Check for publication', exact: true }).click();
  await expect(review).toContainText('Check interrupted');
  await expect(review).toContainText('teaching files have not been verified');
  await expect(review.getByRole('alert')).toContainText('Temporarily unavailable');
  await expect(review.locator('.review-issue-group')).toHaveCount(0);
  await expect(page.getByLabel('Option B', { exact: true })).toHaveValue('Robin');
  await page.unroute(`**/api/assignments/${assignment.id}/validate`);
  await review.getByRole('button', { name: 'Check for publication', exact: true }).click();
  await expect(review).toContainText('Current teaching files were also checked.');
  await expect(review.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Option B', { exact: true }).fill('Robin, revised');
  await expect(review).toContainText('Needs recheck');
  await expect(review).not.toContainText('Current question content checks passed');
});
test('grouped issues stay compact and the editor fits narrow viewports', async ({ page }, info) => {
  const initialViewport = page.viewportSize()!;
  await login(page);
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await page.getByRole('button', { name: 'Add question', exact: true }).click();
  await page.getByRole('button', { name: 'Check for publication', exact: true }).click();
  const review = page.getByLabel('Publication check results', { exact: true });
  await expect(review.locator('.review-issue-group')).toHaveCount(3);
  await review.locator('summary').filter({ hasText: 'Question 1' }).click();
  await expect(
    review.getByRole('button', {
      name: 'Question 1 · Option B: Enter text or add a ready image or audio file.',
      exact: true,
    }),
  ).not.toBeVisible();
  await review
    .getByRole('button', {
      name: 'Question 2 · Option B: Enter text or add a ready image or audio file.',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Option B', { exact: true }).nth(1)).toBeFocused();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(
      await review
        .locator('.review-issue-groups')
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(320);
  }
  await page.setViewportSize(initialViewport);
  await page.locator('.form-heading').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/${info.project.name}-authoring-grouped-review.png` });
});
test('checks use unsaved content and ignore a late response after further editing', async ({
  page,
}) => {
  await login(page);
  const assignment = await fixture(page, true);
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Option B', { exact: true }).fill('Robin');
  await page.getByRole('button', { name: 'Check for publication', exact: true }).click();
  const summary = page.getByLabel('Publication check results', { exact: true });
  await expect(summary.getByRole('status')).toHaveText('Current question content checks passed');
  await expect(summary).toContainText('Current teaching files were also checked.');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/assignments/${assignment.id}/validate`, async (route) => {
    await gate;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        errors: [
          {
            questionId: assignment.questions[0].id,
            path: 'prompt',
            code: 'INVALID_QUESTION',
            message: 'STALE CHECK ERROR',
          },
        ],
      }),
    });
  });
  const requested = page.waitForRequest(`**/api/assignments/${assignment.id}/validate`);
  await page.getByRole('button', { name: 'Check for publication', exact: true }).click();
  await requested;
  await expect(summary).toContainText('Checking current edits…');
  await page.getByLabel('Option B', { exact: true }).fill('Robin, updated after checking');
  await expect(summary).toContainText('Needs recheck');
  const responded = page.waitForResponse(`**/api/assignments/${assignment.id}/validate`);
  release();
  await responded;
  await expect(summary).not.toContainText('STALE CHECK ERROR');
  await expect(summary).not.toContainText('Current teaching files were also checked.');
  await expect(summary).not.toContainText('Current question content checks passed');
});
test('undo removal preserves later text and supports successive option removals', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await page.getByLabel('Option D', { exact: true }).fill('Original option D');
  await page
    .getByRole('radio', { name: 'Mark option D as correct for question 1', exact: true })
    .check();
  await page.getByRole('button', { name: 'Remove option D from question 1', exact: true }).click();
  await page.getByLabel('Question text', { exact: true }).fill('Keep the newest question text');
  await page.getByLabel('Option A', { exact: true }).fill('Keep the newest option A');
  await page.getByRole('button', { name: 'Remove option C from question 1', exact: true }).click();
  await page.getByRole('button', { name: 'Undo removal', exact: true }).click();
  await expect(page.getByLabel('Option C', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo removal', exact: true }).click();
  await expect(page.getByLabel('Option D', { exact: true })).toHaveValue('Original option D');
  await expect(
    page.getByRole('radio', { name: 'Mark option D as correct for question 1', exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel('Question text', { exact: true })).toHaveValue(
    'Keep the newest question text',
  );
  await expect(page.getByLabel('Option A', { exact: true })).toHaveValue(
    'Keep the newest option A',
  );
});
test('publication requires reviewing recipients and restrictions; cancelling never publishes', async ({
  page,
}, info) => {
  await login(page);
  const assignment = await fixture(page);
  let publications = 0;
  page.on('request', (r) => {
    if (r.url().endsWith(`/assignments/${assignment.id}/publish`) && r.method() === 'POST')
      publications++;
  });
  await page.getByRole('button', { name: 'Publish to class →', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish this assignment?', exact: true });
  await expect(dialog).toContainText('English · Group A');
  await expect(dialog).toContainText('Recipients: 1 current students');
  await expect(dialog).toContainText('1 answerable questions · 1 points');
  await expect(dialog).toContainText('questions cannot be edited');
  await expect(dialog).toContainText('Deadline:');
  await page.screenshot({ path: `test-results/${info.project.name}-p1-publish-confirmation.png` });
  await dialog.getByRole('button', { name: 'Keep reviewing', exact: true }).click();
  expect(publications).toBe(0);
  await expect(page.getByRole('button', { name: 'Edit draft', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish to class →', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Student progress', exact: true })).toBeVisible();
  expect(publications).toBe(1);
});
