import { test, expect, type Page } from '@playwright/test';
const password = 'LocalStudy2026!';
async function login(page: Page, email = 'teacher@example.test') {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
const navigate = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('button', { name, exact: true })
    .click();

test('teacher invites a student, edits and publishes; student submits; teacher preserves grades after removal', async ({
  page,
  browser,
}, info) => {
  const className = `E2E ${info.project.name} ${Date.now()}`;
  const title = `${className} arithmetic`;
  const studentEmail = `e2e-${info.project.name}-${Date.now()}@example.test`;
  await login(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Make learning happen.' })).toBeVisible();
  await navigate(page, 'Classes');
  await page.getByLabel('Class name').fill(className);
  await page.getByRole('button', { name: 'Create class', exact: true }).click();
  await page.getByRole('button', { name: 'Generate invitation' }).click();
  const code = await page.getByLabel('New invitation code').inputValue();
  expect(code).toHaveLength(43);
  const studentContext = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
    recordVideo: { dir: 'test-results/student-videos' },
  });
  const student = await studentContext.newPage();
  try {
    await student.goto('http://127.0.0.1:5175/');
    await student.getByRole('button', { name: 'Have an invitation? Create an account' }).click();
    await student.getByLabel('Your name').fill('E2E Learner');
    await student.getByLabel('Invitation code', { exact: true }).fill(code);
    await student.getByLabel('Email', { exact: true }).fill(studentEmail);
    await student.getByLabel('Password', { exact: true }).fill(password);
    await student.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(student.getByRole('heading', { name: 'You’re all caught up.' })).toBeVisible();
    await navigate(page, 'Assignments');
    await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page
      .getByRole('combobox', { name: 'Class', exact: true })
      .selectOption({ label: className });
    await page.getByLabel('Deadline · your local time').fill('2035-10-01T12:00');
    await page.getByLabel('Question text', { exact: true }).fill('What is 2 + 2?');
    for (const [letter, value] of [
      ['A', '4'],
      ['B', '3'],
      ['C', '5'],
      ['D', '6'],
    ])
      await page.getByLabel(`Option ${letter}`, { exact: true }).fill(value!);
    await page.getByRole('button', { name: 'Save draft →', exact: true }).click();
    await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill(`${title} revised`);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('button', { name: 'Publish to class →', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Student progress', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Not submitted', exact: true })).toBeVisible();
    await student.reload();
    await student
      .getByRole('button')
      .filter({ has: student.getByRole('heading', { name: `${title} revised`, exact: true }) })
      .click();
    await expect(student.getByText('Answer key', { exact: true })).toHaveCount(0);
    await student.getByRole('radio', { name: '4', exact: true }).check();
    await student.route(
      '**/api/assignments/*/submissions',
      async (route) => {
        await route.fetch();
        await route.abort('failed');
      },
      { times: 1 },
    );
    await student.getByRole('button', { name: 'Submit answers →', exact: true }).click();
    await expect(student.getByRole('alert')).toBeVisible();
    await student.getByRole('button', { name: 'Submit answers →', exact: true }).click();
    await expect(student.getByText('Submitted · 10 / 10 points', { exact: true })).toBeVisible();
    await student.reload();
    await student
      .getByRole('button')
      .filter({ has: student.getByRole('heading', { name: `${title} revised`, exact: true }) })
      .click();
    await expect(student.getByText('Submitted · 10 / 10 points', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByLabel('Search title').fill(`${title} revised`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page
      .getByRole('button')
      .filter({ has: page.getByRole('heading', { name: `${title} revised`, exact: true }) })
      .click();
    await expect(page.getByRole('cell', { name: '10 / 10', exact: true })).toBeVisible();
    await page.screenshot({
      path: `test-results/${info.project.name}-teacher-results.png`,
      fullPage: true,
    });
    await student.screenshot({
      path: `test-results/${info.project.name}-student-result.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(
      await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await navigate(page, 'Classes');
    await page.getByRole('button', { name: className, exact: true }).click();
    await page.getByRole('button', { name: 'Remove E2E Learner', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await expect(page.getByText('No students have joined yet.', { exact: true })).toBeVisible();
    await student.reload();
    await expect(student.getByRole('heading', { name: 'You’re all caught up.' })).toBeVisible();
    await navigate(page, 'Assignments');
    await page
      .getByRole('button')
      .filter({ has: page.getByRole('heading', { name: `${title} revised`, exact: true }) })
      .click();
    await expect(page.getByRole('cell', { name: '10 / 10', exact: true })).toBeVisible();
    await expect(page.getByRole('cell').filter({ hasText: 'Removed' })).toBeVisible();
    const cookie = (await page.context().cookies()).find((c) => c.name === 'classwork_session')!;
    expect(cookie.httpOnly).toBe(true);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    const replay = await page.request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${cookie.value}` },
    });
    expect(replay.status()).toBe(401);
  } finally {
    await studentContext.close();
  }
});

test('keyboard sign-in, empty filter, error recovery and session expiry', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('other.teacher@example.test');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Make learning happen.' })).toBeVisible();
  await page.getByLabel('Search title').fill(`No matches ${Date.now()}`);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching assignments.' })).toBeVisible();
  await page.route(
    '**/api/assignments?**',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Temporary outage' }),
      }),
    { times: 1 },
  );
  await page.getByLabel('Filter by status').selectOption('DRAFT');
  await expect(page.getByRole('alert')).toContainText('Temporary outage');
  await page.getByRole('button', { name: 'Retry loading assignments' }).click();
  await expect(page.getByRole('heading', { name: 'No matching assignments.' })).toBeVisible();
  await page.context().clearCookies();
  await page.getByLabel('Filter by status').selectOption('PUBLISHED');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('expired');
});

test('question option limits, correct-answer reindexing and draft deletion work in the editor', async ({
  page,
}, info) => {
  await login(page);
  const title = `Editor ${info.project.name} ${Date.now()}`;
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Deadline · your local time').fill('2035-10-01T12:00');
  await page.getByLabel('Question text', { exact: true }).fill('Which option is selected?');
  for (const letter of ['A', 'B', 'C', 'D'])
    await page.getByLabel(`Option ${letter}`, { exact: true }).fill(`Original ${letter}`);
  const correct = page.getByRole('combobox', { name: 'Correct answer', exact: true });
  await correct.selectOption('3');
  await page.getByRole('button', { name: 'Remove option B from question 1', exact: true }).click();
  await expect(correct).toHaveValue('2');
  await page.getByRole('button', { name: 'Remove option C from question 1', exact: true }).click();
  await expect(correct).toHaveValue('0');
  await expect(page.getByRole('button', { name: /Remove option/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save draft →', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  for (const letter of ['C', 'D', 'E', 'F']) {
    await page.getByRole('button', { name: 'Add option to question 1', exact: true }).click();
    await page.getByLabel(`Option ${letter}`, { exact: true }).fill(`Extra ${letter}`);
  }
  await expect(
    page.getByRole('button', { name: 'Add option to question 1', exact: true }),
  ).toBeDisabled();
  await correct.selectOption('5');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(6);
  await expect(page.getByText('Answer key').locator('..')).toContainText('Extra F');
  await page.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await page.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await page.getByLabel('Search title').fill(title);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching assignments.' })).toBeVisible();
});
