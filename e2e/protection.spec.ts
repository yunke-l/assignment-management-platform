import { selectChoice } from './controls.js';
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const password = 'LocalStudy2026!';
const origin = 'http://127.0.0.1:5175';
const nav = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('button', { name, exact: true });
async function login(page: Page, email = 'teacher@example.test') {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await expect(nav(page, 'Assignments')).toBeVisible();
}
async function fillAssignment(page: Page, title: string) {
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Deadline date', { exact: true }).fill('2035-10-01');
  await page.getByLabel('Deadline time', { exact: true }).fill('12:00');
  await page.getByLabel('Question text', { exact: true }).fill('Which animal is nocturnal?');
  for (const letter of ['A', 'B', 'C', 'D'])
    await page.getByLabel(`Option ${letter}`, { exact: true }).fill(`Answer ${letter}`);
}
async function fixture(page: Page, title: string, publish = false) {
  const classes = await (await page.request.get('/api/classes')).json();
  const response = await page.request.post('/api/assignments', {
    headers: { Origin: origin },
    data: {
      classId: classes.find((item: { name: string }) => item.name === 'English · Group A').id,
      title,
      description: '',
      dueAt: '2035-10-01T12:00:00Z',
      questions: [
        { prompt: 'Choose an answer', options: ['Owl', 'Robin'], correctIndex: 0, points: 10 },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  const assignment = await response.json();
  if (publish)
    expect(
      (
        await page.request.post(`/api/assignments/${assignment.id}/publish`, {
          headers: { Origin: origin },
          data: { version: assignment.version },
        })
      ).ok(),
    ).toBe(true);
  return assignment;
}
const row = (page: Page, title: string) =>
  page.getByRole('button').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const browserProblems = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  browserProblems.set(page, problems);
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning') problems.push(message.text());
  });
  page.on(
    'dialog',
    (dialog) => void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()),
  );
});
test.afterEach(async ({ page }) => {
  expect(browserProblems.get(page)).toEqual([]);
});

test('new work survives navigation and reload; cancellation, undo and sign-out protect it', async ({
  page,
}, info) => {
  await login(page);
  await fillAssignment(page, `Protected ${info.project.name}`);
  await page.getByRole('radio', { name: 'Mark option D as correct for question 1' }).check();
  await page.getByRole('button', { name: 'Remove option D from question 1' }).click();
  await page.getByRole('button', { name: 'Undo removal', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: 'Mark option D as correct for question 1' }),
  ).toBeChecked();
  await nav(page, 'Classes').click();
  await page.getByLabel('Class name').fill('Unfinished class');
  await nav(page, 'Assignments').click();
  await page.getByRole('button', { name: 'Resume New assignment', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    `Protected ${info.project.name}`,
  );
  await expect(page.getByLabel('Option D', { exact: true })).toHaveValue('Answer D');
  await nav(page, 'Classes').click();
  await expect(page.getByLabel('Class name')).toHaveValue('Unfinished class');
  await nav(page, 'Assignments').click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume New assignment', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    `Protected ${info.project.name}`,
  );
  await expect(page.getByLabel('Deadline date', { exact: true })).toHaveValue('2035-10-01');
  await expect(
    page.getByRole('radio', { name: 'Mark option D as correct for question 1' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep working', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    `Protected ${info.project.name}`,
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    `Protected ${info.project.name}`,
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
  await page.getByLabel('Title', { exact: true }).fill('Explicitly discarded at sign out');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Clear and sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith('classwork:work:')),
    ),
  ).toEqual([]);
});

test('saved draft edits survive switching assignments, failed save and a version conflict', async ({
  page,
}, info) => {
  await login(page);
  const title = `Versioned ${info.project.name} ${Date.now()}`;
  const original = await fixture(page, title);
  const other = await fixture(page, `${title} other`);
  await page.reload();
  await page.getByLabel('Search title').fill(title);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await row(page, title).click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('My protected edits');
  await page.getByRole('button', { name: '↑ Back to assignments', exact: true }).click();
  await expect(page.getByLabel('Search title')).toBeVisible();
  await row(page, other.title).click();
  await page.locator('.work-recovery > summary').click();
  await page.getByRole('button', { name: `Resume ${title}`, exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My protected edits');
  await page.route(
    `**/api/assignments/${original.id}`,
    (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Temporary save failure' }),
          })
        : route.continue(),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary save failure');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My protected edits');
  const changed = await page.request.patch(`/api/assignments/${original.id}`, {
    headers: { Origin: origin },
    data: {
      classId: original.classId,
      title: 'Changed elsewhere',
      description: '',
      dueAt: new Date(original.dueAt).toISOString(),
      version: original.version,
      questions: [
        { prompt: 'Changed question', options: ['One', 'Two'], correctIndex: 0, points: 10 },
      ],
    },
  });
  expect(changed.ok(), await changed.text()).toBe(true);
  await page.reload();
  await expect(
    page.getByText('The saved draft has changed since you started editing.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My protected edits');
  const server = await (await page.request.get(`/api/assignments/${original.id}`)).json();
  expect(server.title).toBe('Changed elsewhere');
});

test('student answers and retry identity survive navigation, reload and session expiry, with account isolation', async ({
  page,
}, info) => {
  await login(page);
  const title = `Answers ${info.project.name} ${Date.now()}`;
  const assignment = await fixture(page, title, true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, 'student@example.test');
  await page.getByLabel('Search title').fill(title);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await row(page, title).click();
  await page.getByRole('radio', { name: 'Owl', exact: true }).check();
  await nav(page, 'Classes').click();
  await nav(page, 'Assignments').click();
  await row(page, title).click();
  await expect(page.getByRole('radio', { name: 'Owl', exact: true })).toBeChecked();
  let firstId = '';
  await page.route(
    `**/api/assignments/${assignment.id}/submissions`,
    (route) => {
      firstId = route.request().postDataJSON().requestId;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Please retry' }),
      });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Submit answers →', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Submit answers', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Please retry');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Owl', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '↑ Back to assignments', exact: true }).click();
  await expect(page.getByLabel('Filter by status')).toBeVisible();
  await page.context().clearCookies();
  await selectChoice(page.getByLabel('Filter by status'), 'PUBLISHED');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await login(page, 'other.student@example.test');
  await expect(page.getByRole('button', { name: `Resume ${title}`, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, 'student@example.test');
  await page.getByRole('button', { name: `Resume ${title}`, exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Owl', exact: true })).toBeChecked();
  const request = page.waitForRequest(
    (req) =>
      req.method() === 'POST' && req.url().endsWith(`/assignments/${assignment.id}/submissions`),
  );
  await page.getByRole('button', { name: 'Submit answers →', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Submit answers', exact: true })
    .click();
  expect((await request).postDataJSON().requestId).toBe(firstId);
  await expect(page.getByText('Submitted · 10 / 10 points', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Resume ${title}`, exact: true })).toHaveCount(0);
});

test('sensitive fields warn before loss; invitation codes remain in memory and have copy feedback', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await nav(page, 'Classes').click();
  await page.getByRole('button', { name: 'English · Group A', exact: true }).click();
  await page.getByRole('button', { name: 'Generate invitation', exact: true }).click();
  const code = await page.getByLabel('New invitation code', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Copied.');
  await nav(page, 'Assignments').click();
  await nav(page, 'Classes').click();
  await page.getByRole('button', { name: 'English · Group A', exact: true }).click();
  await expect(page.getByLabel('New invitation code', { exact: true })).toHaveValue(code);
  await page.getByRole('button', { name: 'Generate invitation', exact: true }).click();
  await page.getByRole('button', { name: 'Keep current code', exact: true }).click();
  await expect(page.getByLabel('New invitation code', { exact: true })).toHaveValue(code);
  await nav(page, 'Account').click();
  await page.getByLabel('Current password').fill('test-only-unsaved-value');
  await nav(page, 'Assignments').click();
  await page.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(page.getByLabel('Current password')).toHaveValue('test-only-unsaved-value');
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
    'test-only-unsaved-value',
  );
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(code);
  await nav(page, 'Assignments').click();
  await page.getByRole('button', { name: 'Leave page', exact: true }).click();
  await nav(page, 'Account').click();
  await expect(page.getByLabel('Current password')).toHaveValue('');
  await nav(page, 'Assignments').click();
  await expect(page.getByLabel('Filter by status')).toBeVisible();
  await expect(page.getByText('Loading assignments…', { exact: true })).toHaveCount(0);
  await context.clearCookies();
  await selectChoice(page.getByLabel('Filter by status'), 'PUBLISHED');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  // Reauthenticate without reloading: invitation secrets only live in this page.
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await nav(page, 'Classes').click();
  await page.getByRole('button', { name: 'English · Group A', exact: true }).click();
  await expect(page.getByLabel('New invitation code', { exact: true })).toHaveValue(code);
  let reloadWarning = false;
  page.once('dialog', (dialog) => {
    if (dialog.type() === 'beforeunload') reloadWarning = true;
  });
  await page.reload();
  expect(reloadWarning).toBe(true);
  await nav(page, 'Classes').click();
  await page.getByRole('button', { name: 'English · Group A', exact: true }).click();
  await expect(page.getByLabel('New invitation code', { exact: true })).toHaveCount(0);
});

test('unavailable storage keeps work in memory and a pending save blocks navigation', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    };
  });
  await login(page);
  await fillAssignment(page, `Memory fallback ${info.project.name}`);
  await expect(page.getByText('Browser storage is unavailable.', { exact: false })).toBeVisible();
  await nav(page, 'Classes').click();
  await nav(page, 'Assignments').click();
  await page.getByRole('button', { name: 'Resume New assignment', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    `Memory fallback ${info.project.name}`,
  );
  let release: (() => void) | undefined;
  await page.route(
    '**/api/assignments',
    async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Save draft →', exact: true }).click();
  await expect(nav(page, 'Classes')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/\/assignments\/new$/);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    `Memory fallback ${info.project.name}`,
  );
  release!();
  await expect(page.getByRole('button', { name: 'Edit draft', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Resume New assignment', exact: true }),
  ).toHaveCount(0);
});

test('an invalid success response preserves the complete assignment until a real save succeeds', async ({
  page,
}, info) => {
  await login(page);
  const title = `Invalid response ${info.project.name} ${Date.now()}`;
  await fillAssignment(page, title);
  await page.route(
    '**/api/assignments',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html>Temporary proxy response</html>',
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Save draft →', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid response from the server');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title);
  await expect(page.getByLabel('Option D', { exact: true })).toHaveValue('Answer D');
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title);
  await page.getByRole('button', { name: 'Save draft →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit draft', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Resume New assignment', exact: true }),
  ).toHaveCount(0);
});

test('discarding conflicted edits reloads the current saved version without a browser refresh', async ({
  page,
}, info) => {
  await login(page);
  const title = `Conflict recovery ${info.project.name} ${Date.now()}`;
  const original = await fixture(page, title);
  await page.reload();
  await page.getByLabel('Search title').fill(title);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await row(page, title).click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Local stale title');
  const changedTitle = `${title} updated elsewhere`;
  const changed = await page.request.patch(`/api/assignments/${original.id}`, {
    headers: { Origin: origin },
    data: {
      classId: original.classId,
      title: changedTitle,
      description: '',
      dueAt: original.dueAt,
      version: original.version,
      questions: [
        { prompt: 'Current server question', options: ['One', 'Two'], correctIndex: 1, points: 20 },
      ],
    },
  });
  expect(changed.ok(), await changed.text()).toBe(true);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Local stale title');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Assignment details', exact: true })
      .getByRole('heading', { name: changedTitle, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(changedTitle);
  await expect(page.getByRole('textbox', { name: 'Question text', exact: true })).toHaveValue(
    'Current server question',
  );
  await expect(
    page.getByRole('radio', { name: 'Mark option B as correct for question 1' }),
  ).toBeChecked();
  await page.getByLabel('Title', { exact: true }).fill(`${title} resolved`);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit draft', exact: true })).toBeVisible();
  const saved = await (await page.request.get(`/api/assignments/${original.id}`)).json();
  expect(saved.title).toBe(`${title} resolved`);
  expect(saved.version).toBe(original.version + 2);
});

test('an older teacher editor draft restores original text without reusing local identities as server IDs', async ({
  page,
}, info) => {
  await login(page);
  const user = await (await page.request.get('/api/auth/me')).json();
  const classes = await (await page.request.get('/api/classes')).json();
  const title = `Older teacher copy ${info.project.name}`;
  const old = {
    classId: classes[0].id,
    title,
    description: 'Original teaching description',
    dueDate: '2035-10-01',
    dueTime: '12:00',
    questions: [
      {
        id: 'old-local-question',
        prompt: 'Recovered instruction',
        points: '10',
        correctId: 'old-b',
        options: [
          { id: 'old-a', text: 'Owl' },
          { id: 'old-b', text: 'Robin' },
        ],
      },
    ],
  };
  await page.evaluate(
    ({ id, draft }) =>
      sessionStorage.setItem(
        `classwork:work:v1:${id}`,
        JSON.stringify({
          'assignment:new': { label: 'New assignment', persist: true, value: draft },
        }),
      ),
    { id: user.id, draft: old },
  );
  await page.reload();
  await page.getByRole('button', { name: 'Resume New assignment', exact: true }).click();
  await expect(
    page.getByText('Recovered work from the previous editor', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Question text', { exact: true })).toHaveValue(
    'Recovered instruction',
  );
  await expect(
    page.getByRole('radio', { name: 'Mark option B as correct for question 1', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Save draft →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit draft', exact: true })).toBeVisible();
  const list = await (
    await page.request.get(`/api/assignments?search=${encodeURIComponent(title)}`)
  ).json();
  const saved = await (
    await page.request.get(`/api/assignments/${list.items[0].id}?schemaVersion=2`)
  ).json();
  expect(saved.questions[0].id).not.toBe('old-local-question');
  expect(saved.questions[0].config.options[1].id).toBe(
    saved.questions[0].answerKey.correctOptionId,
  );
});

test('older student choices and their unchanged pending legacy request survive the schema upgrade', async ({
  page,
}, info) => {
  await login(page);
  const title = `Older answer copy ${info.project.name} ${Date.now()}`;
  const assignment = await fixture(page, title, true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, 'student@example.test');
  const user = await (await page.request.get('/api/auth/me')).json();
  const requestId = randomUUID();
  await page.evaluate(
    ({ userId, assignmentId, questionId, title, requestId }) =>
      sessionStorage.setItem(
        `classwork:work:v1:${userId}`,
        JSON.stringify({
          [`answers:${assignmentId}`]: {
            label: title,
            persist: true,
            value: {
              answers: { [questionId]: 0 },
              retry: { id: requestId, fingerprint: 'legacy pending request' },
            },
          },
        }),
      ),
    {
      userId: user.id,
      assignmentId: assignment.id,
      questionId: assignment.questions[0].id,
      title,
      requestId,
    },
  );
  await page.reload();
  await page.getByRole('button', { name: `Resume ${title}`, exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Owl', exact: true })).toBeChecked();
  await expect(
    page.getByText('Recovered work from the previous editor', { exact: true }),
  ).toBeVisible();
  const sent = page.waitForRequest(
    (req) =>
      req.method() === 'POST' && req.url().endsWith(`/assignments/${assignment.id}/submissions`),
  );
  await page.getByRole('button', { name: 'Submit answers →', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Submit answers', exact: true })
    .click();
  expect((await sent).postDataJSON()).toEqual({
    requestId,
    answers: [{ questionId: assignment.questions[0].id, selectedIndex: 0 }],
  });
  await expect(page.getByText('Submitted · 10 / 10 points', { exact: true })).toBeVisible();
});

test('upload initialization cancellation and overlapping draft saves preserve the newest media references', async ({
  page,
}, info) => {
  await login(page);
  const title = `Upload race ${info.project.name} ${Date.now()}`;
  const assignment = await fixture(page, title);
  await page.reload();
  await page.getByLabel('Search title').fill(title);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await row(page, title).click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const prompt = page.locator('.question-editor').first().locator('.content-editor').first();
  const image = {
    name: 'race.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  };
  let releaseInit!: () => void;
  let initialized!: (id: string) => void;
  const initGate = new Promise<void>((resolve) => {
    releaseInit = resolve;
  });
  const initializedAsset = new Promise<string>((resolve) => {
    initialized = resolve;
  });
  await page.route('**/api/assets/uploads', async (route) => {
    const response = await route.fetch();
    initialized((await response.json()).id);
    await initGate;
    await route.fulfill({ response });
  });
  await prompt.getByLabel('Upload image', { exact: true }).setInputFiles(image);
  const cancelledId = await initializedAsset;
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Wait for uploads to finish, or choose Save and keep editing.',
  );
  await prompt.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  releaseInit();
  await expect
    .poll(async () => (await page.request.get(`/api/assets/${cancelledId}`)).status())
    .toBe(404);
  await expect(prompt.locator('.content-block-editor')).toHaveCount(1);

  let releaseUpload!: () => void, initializedAgain!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const nextInitialized = new Promise<void>((resolve) => {
    initializedAgain = resolve;
  });
  await page.route(
    '**/api/assets/uploads',
    async (route) => {
      const response = await route.fetch();
      initializedAgain();
      await uploadGate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  let releaseSave!: () => void, saved!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const savedOnServer = new Promise<void>((resolve) => {
    saved = resolve;
  });
  let heldSave = false;
  await page.route(
    `**/api/assignments/${assignment.id}`,
    async (route) => {
      if (route.request().method() !== 'PATCH' || heldSave) {
        await route.continue();
        return;
      }
      heldSave = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      saved();
      await saveGate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await prompt.getByLabel('Upload image', { exact: true }).setInputFiles(image);
  await nextInitialized;
  await page.getByRole('button', { name: 'Save and keep editing', exact: true }).click();
  await savedOnServer;
  releaseUpload();
  await expect(
    prompt.getByRole('button', { name: 'Enlarge Teaching media', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  releaseSave();
  await expect(
    page.getByRole('button', { name: 'Save and keep editing', exact: true }),
  ).toBeEnabled();
  await expect(
    prompt.getByRole('button', { name: 'Enlarge Teaching media', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit draft', exact: true })).toBeVisible();
  const final = await (
    await page.request.get(`/api/assignments/${assignment.id}?schemaVersion=2`)
  ).json();
  expect(
    final.questions[0].prompt.filter((block: { type: string }) => block.type === 'image'),
  ).toHaveLength(1);
});
