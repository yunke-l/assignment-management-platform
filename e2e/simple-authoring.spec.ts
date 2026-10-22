import { selectChoice } from './controls.js';
import { test, expect, type Locator } from '@playwright/test';
import { questionV2Schema, validateQuestions, type AssignmentDetailV2 } from '@amp/contracts';

test('teachers can author every type with nearby answers and optional advanced settings', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill('LocalStudy2026!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(`Simple authoring ${info.project.name}`);
  await page.getByLabel('Deadline date', { exact: true }).fill('2035-10-01');
  await page.getByLabel('Deadline time', { exact: true }).fill('12:00');
  const add = async (type: string) => {
    await selectChoice(
      page.getByRole('combobox', { name: 'Add question type', exact: true }),
      type,
    );
    await page.getByRole('button', { name: 'Add question', exact: true }).click();
    return page.locator('.question-editor').last();
  };
  const single = async (editor: Locator, number: string) => {
    await editor.getByLabel('Question text', { exact: true }).fill('Which animal flies?');
    for (const [index, value] of ['Owl', 'Cat', 'Dog', 'Fish'].entries())
      await editor
        .getByLabel(`Option ${String.fromCharCode(65 + index)}`, { exact: true })
        .fill(value);
    const correct = editor.getByRole('radio', {
      name: `Mark option A as correct for question ${number}`,
      exact: true,
    });
    await correct.check();
    await expect(editor.locator('.choice-editor').first()).toContainText('Correct answer');
    await expect(correct).toBeChecked();
  };
  let editor = page.locator('.question-editor').first();
  await single(editor, '1');
  await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toHaveCount(0);
  await editor
    .locator('.editor-tools')
    .first()
    .getByText('Formatting & block options', { exact: true })
    .click();
  await editor.getByRole('button', { name: 'Bold', exact: true }).click();
  await editor
    .locator('.editor-tools')
    .first()
    .getByText('Formatting & block options', { exact: true })
    .click();

  editor = await add('FILL_BLANK');
  await editor.getByRole('button', { name: 'Add blank', exact: true }).click();
  await editor.getByLabel('Question text', { exact: true }).fill('The sky is [blank 1].');
  await editor
    .getByLabel('Accepted answers for blank 1 (one per line)', { exact: true })
    .fill('blue\nazure');

  editor = await add('CLOZE_CHOICE');
  await editor.getByRole('button', { name: 'Add blank', exact: true }).click();
  await editor.getByLabel('Question text', { exact: true }).fill('The owl [blank 1].');
  await editor.getByLabel('Blank 1 option 1', { exact: true }).fill('flies');
  await editor.getByLabel('Blank 1 option 2', { exact: true }).fill('swims');
  await editor
    .getByRole('radio', { name: 'Mark option 1 as correct for blank 1', exact: true })
    .check();

  editor = await add('GROUPING');
  await editor.getByLabel('Question text', { exact: true }).fill('Put each word in its category.');
  await editor.getByLabel('Category 1', { exact: true }).fill('Fruit');
  await editor.getByLabel('Category 2', { exact: true }).fill('Vegetables');
  await editor.getByLabel('Item 1', { exact: true }).fill('Apple');
  await editor.getByLabel('Item 2', { exact: true }).fill('Carrot');
  await selectChoice(editor.getByLabel('Correct category for Apple', { exact: true }), {
    label: 'Fruit',
  });
  await selectChoice(editor.getByLabel('Correct category for Carrot', { exact: true }), {
    label: 'Vegetables',
  });
  await expect(editor.locator('.choice-editor').nth(2)).toContainText('Correct category for Apple');
  await editor.screenshot({ path: `test-results/${info.project.name}-simple-grouping.png` });

  editor = await add('MATCHING');
  await editor
    .getByLabel('Question text', { exact: true })
    .fill('Match each bird to its active time.');
  await editor.getByLabel('Match option 1', { exact: true }).fill('Night');
  await editor.getByLabel('Match option 2', { exact: true }).fill('Day');
  await editor.getByLabel('Item 1', { exact: true }).fill('Owl');
  await editor.getByLabel('Item 2', { exact: true }).fill('Nightjar');
  await editor.getByText('Matching rules · Each match used once', { exact: true }).click();
  await selectChoice(editor.getByLabel('Matching mode', { exact: true }), 'MANY_TO_ONE');
  await editor.getByText('Matching rules · Matches can be reused', { exact: true }).click();
  await selectChoice(editor.getByLabel('Correct match for Owl', { exact: true }), {
    label: 'Night',
  });
  await selectChoice(editor.getByLabel('Correct match for Nightjar', { exact: true }), {
    label: 'Night',
  });

  editor = await add('ORDERING');
  await editor.getByLabel('Question text', { exact: true }).fill('Put these steps in order.');
  await editor.getByLabel('Card 1', { exact: true }).fill('First');
  await editor.getByLabel('Card 2', { exact: true }).fill('Second');
  await editor.getByRole('button', { name: 'Set correct order', exact: true }).click();
  await expect(editor.getByRole('heading', { name: 'Correct order', exact: true })).toBeVisible();

  editor = await add('RESPONSE');
  await editor
    .getByLabel('Question text', { exact: true })
    .fill('Describe an owl and attach a picture.');
  await editor.getByRole('checkbox', { name: 'Allow images', exact: true }).check();
  await editor.getByRole('checkbox', { name: 'Allow audio', exact: true }).check();
  await expect(editor.getByRole('spinbutton', { name: 'Minimum images', exact: true })).toHaveCount(
    0,
  );
  await editor.getByText('Answer requirements & file limits', { exact: true }).click();
  await editor.getByLabel('Minimum images', { exact: true }).fill('1');
  await editor.getByLabel('Maximum images', { exact: true }).fill('2');
  await editor.getByText('Answer requirements & file limits', { exact: true }).click();
  await expect(editor).toContainText('1–2 images');
  await editor.getByRole('button', { name: 'Add grading criterion', exact: true }).click();
  await editor.getByLabel('Criterion 1 name', { exact: true }).fill('Clear description');
  await editor
    .getByLabel('How to award points for criterion 1', { exact: true })
    .fill('Describe two features of the owl.');
  await editor.getByRole('spinbutton', { name: 'Points', exact: true }).fill('5');
  await editor.screenshot({ path: `test-results/${info.project.name}-simple-response.png` });

  editor = await add('READING');
  await editor
    .getByLabel('Question text', { exact: true })
    .fill('Owls are birds. Many owls hunt at night.');
  const group = page.locator('.editor-question').last();
  await group.getByRole('button', { name: 'Add child question', exact: true }).click();
  await single(page.locator('.question-editor').last(), '8.1');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/assignments') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save and keep editing', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBe(true);
  const assignment: AssignmentDetailV2 = await response.json();
  const questions = questionV2Schema.array().parse(assignment.questions);
  expect(validateQuestions(questions)).toEqual([]);
  expect(assignment.questions).toHaveLength(9);
  const matching = assignment.questions.find((q) => q.type === 'MATCHING')!;
  expect(matching.type === 'MATCHING' && matching.config.mode).toBe('MANY_TO_ONE');
  const written = assignment.questions.find((q) => q.type === 'RESPONSE')!;
  expect(written.type === 'RESPONSE' && written.config.minImages).toBe(1);
  expect(written.type === 'RESPONSE' && written.config.maxImages).toBe(2);
  expect(written.type === 'RESPONSE' && written.config.maxAudios).toBe(2);
  await page.getByRole('button', { name: 'Check for publication', exact: true }).click();
  await expect(page.getByLabel('Publication check results', { exact: true })).toContainText(
    'Current teaching files were also checked.',
  );
  await expect(
    page.getByLabel('Publication check results', { exact: true }).getByRole('status'),
  ).toHaveText('Current question content checks passed');
  expect(errors).toEqual([]);
});
