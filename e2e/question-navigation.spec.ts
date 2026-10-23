import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Content, QuestionV2 } from '@amp/contracts';
import { newQuestion } from '../apps/web/src/question-editor.js';

const origin = 'http://127.0.0.1:5175';
const text = (value: string): Content => [
  { id: randomUUID(), type: 'paragraph', children: [{ type: 'text', text: value }] },
];
function fixtureQuestions() {
  const roots = Array.from({ length: 10 }, (_, index) =>
    newQuestion(index === 7 || index === 8 ? 'COMPOSITE' : 'SINGLE_CHOICE', null, index, true),
  );
  const children = [
    newQuestion('SINGLE_CHOICE', roots[7]!.id, 0),
    newQuestion('SINGLE_CHOICE', roots[7]!.id, 1),
    newQuestion('SINGLE_CHOICE', roots[8]!.id, 0),
  ];
  return [children[2]!, roots[0]!, children[1]!, children[0]!, ...roots.slice(1)].map(
    (q): QuestionV2 => {
      q.prompt = text(
        q.type === 'COMPOSITE' ? 'Read these shared materials.' : 'Choose one animal.',
      );
      if (q.type === 'SINGLE_CHOICE') {
        q.config.options = q.config.options
          .slice(0, 2)
          .map((option, index) => ({ ...option, content: text(index ? 'Robin' : 'Owl') }));
        q.answerKey.correctOptionId = q.config.options[0]!.id;
      }
      return q;
    },
  );
}

test('directory, question bodies and analysis share group numbering; materials have no ambiguous return link', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill('LocalStudy2026!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await page.locator('.assignment-list').waitFor();
  const classes = await (await page.request.get('/api/classes')).json();
  const response = await page.request.post('/api/assignments', {
    headers: { Origin: origin },
    data: {
      schemaVersion: 2,
      classId: classes.find((c: { name: string }) => c.name === 'English · Group A').id,
      title: `Numbered questions ${randomUUID()}`,
      description: '',
      dueAt: '2035-10-01T12:00:00Z',
      questions: fixtureQuestions(),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const assignment = await response.json();
  await page.goto(`/assignments/${assignment.id}`);
  const expected = ['1', '2', '3', '4', '5', '6', '7', '8.1', '8.2', '9.1', '10'];
  const directory = page.getByRole('navigation', { name: 'Question directory' });
  await expect(directory.getByRole('link')).toHaveText(expected);
  await expect(page.locator('.mixed-question .question-number')).toHaveText(expected);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const firstLink = directory.getByRole('link', { name: '1', exact: true });
  await expect(firstLink).toBeInViewport();
  const firstBox = await firstLink.boundingBox();
  const secondBox = await directory.getByRole('link', { name: '2', exact: true }).boundingBox();
  expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThan(1);
  expect(secondBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height);
  await firstLink.click();
  await expect(page.getByRole('region', { name: 'Question 1', exact: true })).toBeInViewport();
  await expect(page.getByText('Teacher answer configuration', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Return to current question' })).toHaveCount(0);
  await directory.getByRole('link', { name: '8.1', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Question 8.1', exact: true })).toBeInViewport();
  await directory.getByRole('link', { name: '9.1', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Question 9.1', exact: true })).toBeInViewport();
  const publication = await page.request.post(`/api/assignments/${assignment.id}/publish`, {
    headers: { Origin: origin },
    data: { schemaVersion: 2, version: assignment.version },
  });
  expect(publication.ok(), await publication.text()).toBe(true);
  await page.reload();
  await page.getByText('Question analysis', { exact: true }).click();
  await expect(page.locator('.analysis-card h4')).toHaveText(
    expected.map((number) => `Question ${number}`),
  );
  await expect(page.locator('.analysis-card').first()).toContainText('No submissions yet');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(directory.getByRole('link', { name: '1', exact: true })).toBeInViewport();
});

test('local question checks and draft save errors use readable field messages', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill('LocalStudy2026!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Readable validation');
  await page.getByLabel('Deadline date', { exact: true }).fill('2035-10-01');
  await page.getByLabel('Deadline time', { exact: true }).fill('12:00');
  await page.getByText('Short label (for media-only items)', { exact: true }).first().click();
  const label = page.getByLabel('Option 1 short label', { exact: true });
  await label.fill('x'.repeat(101));
  await page.getByRole('button', { name: 'Check for publication', exact: true }).click();
  const summary = page.getByLabel('Publication check results', { exact: true });
  await expect(summary).toContainText('Label: Use 0–100 characters.');
  await expect(summary).not.toContainText('Too big');
  await label.fill('Owl');
  await page.getByLabel('Title', { exact: true }).fill('x'.repeat(121));
  await page.getByRole('button', { name: 'Save and keep editing', exact: true }).click();
  await expect(summary).toContainText('Title: Use 1–120 characters.');
  await expect(summary).not.toContainText('Invalid input');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('x'.repeat(121));
});
