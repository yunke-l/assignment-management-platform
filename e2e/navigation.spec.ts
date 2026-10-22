import { selectChoice } from './controls.js';
import { test, expect, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:5175';
const sidebar = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('button', { name, exact: true });
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill('LocalStudy2026!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/assignments`);
}

test('list and detail have separate URLs; return restores filters, page, focus and scroll after refresh', async ({
  page,
}, info) => {
  await login(page);
  const prefix = `Navigation ${info.project.name} ${Date.now()}`;
  const classes = await (await page.request.get('/api/classes')).json();
  const classId = classes.find((c: { name: string }) => c.name === 'English · Group A').id;
  for (let i = 0; i < 18; i++) {
    const response = await page.request.post('/api/assignments', {
      headers: { Origin: origin },
      data: {
        classId,
        title: `${prefix} ${i}`,
        description: 'Navigation fixture',
        dueAt: '2035-10-01T12:00:00Z',
        questions: [
          { prompt: 'Choose one', options: ['Owl', 'Robin'], correctIndex: 0, points: 10 },
        ],
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await page.reload();
  await page.getByLabel('Search title').fill(prefix);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('search') === prefix);
  await selectChoice(page.getByLabel('Filter by class'), classId);
  await expect(page).toHaveURL(new RegExp(`classId=${classId}`));
  await selectChoice(page.getByLabel('Filter by status'), 'DRAFT');
  await expect(page).toHaveURL(/status=DRAFT/);
  const secondPage = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/assignments' && url.searchParams.get('page') === '2';
  });
  await page.getByRole('button', { name: 'Next →', exact: true }).click();
  const secondPageData = await (await secondPage).json();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page.locator(`[data-assignment-id="${secondPageData.items.at(-1).id}"]`),
  ).toBeVisible();
  await expect(page.locator('.assignment-row')).toHaveCount(8);
  const listUrl = page.url();
  expect(new URL(listUrl).searchParams.get('page')).toBe('2');
  const unsubmittedSearch = `${prefix} still typing`;
  await page.getByLabel('Search title').fill(unsubmittedSearch);
  const row = page.locator('.assignment-row').last();
  const id = await row.getAttribute('data-assignment-id');
  const title = await row.getByRole('heading').innerText();
  await row.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(0);
  await row.click();
  await expect(page).toHaveURL(`${origin}/assignments/${id}`);
  await expect(page.getByLabel('Search title')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-assignment-detail.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '↑ Back to assignments', exact: true }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByLabel('Search title')).toHaveValue(unsubmittedSearch);
  await expect(page.getByLabel('Filter by class')).toHaveValue('English · Group A');
  await expect(page.getByLabel('Filter by status')).toHaveValue('Draft');
  await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
  await expect(page.locator(`[data-assignment-id="${id}"]`)).toBeFocused();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - y))
    .toBeLessThan(5);
  await page.screenshot({
    path: `test-results/${info.project.name}-assignment-list.png`,
    fullPage: true,
  });
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/assignments/${id}`);
  await page.goForward();
  await expect(page).toHaveURL(listUrl);
  await expect(page.locator(`[data-assignment-id="${id}"]`)).toBeFocused();
});

test('browser back and forward preserve unfinished editor content and direct edit refresh', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await login(page);
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/assignments/new`);
  await page.getByLabel('Title', { exact: true }).fill('Unfinished navigation draft');
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/assignments`);
  await expect(page.getByLabel('Search title')).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Unfinished navigation draft',
  );
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Unfinished navigation draft',
  );
  await page.getByLabel('Deadline date', { exact: true }).fill('2035-10-01');
  await page.getByLabel('Deadline time', { exact: true }).fill('12:00');
  await page.getByRole('button', { name: 'Save draft →', exact: true }).click();
  await expect(page).toHaveURL(/\/assignments\/[a-f0-9-]+$/);
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel('Title', { exact: true }).fill('A preserved edit');
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('A preserved edit');
  await page.getByRole('button', { name: '↑ Back to assignments', exact: true }).click();
  await expect(page.getByLabel('Search title')).toBeVisible();
});

test('cancelled browser back keeps password fields and history consistent', async ({ page }) => {
  await login(page);
  await sidebar(page, 'Account').click();
  await page.getByLabel('Current password').fill('sensitive unfinished password');
  // Do not await goBack: the router deliberately blocks the transition.
  await page.evaluate(() => window.history.back());
  const dialog = page.getByRole('dialog', { name: 'Leave these password changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/account`);
  await expect(page.getByLabel('Current password')).toHaveValue('sensitive unfinished password');
  await page.evaluate(() => window.history.back());
  await dialog.getByRole('button', { name: 'Leave page', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/assignments`);
  await page.goForward();
  await expect(page).toHaveURL(`${origin}/account`);
  await expect(page.getByLabel('Current password')).toHaveValue('');
});

test('an unavailable assignment keeps a working return path', async ({ page }) => {
  await login(page);
  await page.goto('/assignments/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '↑ Back to assignments', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/assignments`);
  await expect(page.getByLabel('Search title')).toBeVisible();
});
