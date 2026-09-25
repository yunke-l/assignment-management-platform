import { test, expect, type Page } from '@playwright/test';

async function capture(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    `${name} should fit the viewport without horizontal scrolling`,
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${name}.png`,
    fullPage: true,
    scale: 'css',
    animations: 'disabled',
  });
}

test('owl design stays usable across sign-in, editing, class management and account settings', async ({
  page,
}, info) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const prefix = `${info.project.name}-owl`;
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ollie the owl reading a book' })).toBeVisible();
  await capture(page, `${prefix}-login`);
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill('LocalStudy2026!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make learning happen.' })).toBeVisible();
  await expect(page.getByText('Loading assignments…', { exact: true })).toHaveCount(0);
  await capture(page, `${prefix}-workspace`);
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  if (info.project.name === 'mobile') {
    await expect(
      page.getByRole('heading', { name: 'Create an assignment', exact: true }),
    ).toBeInViewport();
    await page.getByRole('button', { name: '↑ Back to assignments', exact: true }).click();
    await expect(page.getByLabel('Search title')).toBeInViewport();
    await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Create an assignment', exact: true }),
    ).toBeInViewport();
  }
  await page.getByLabel('Title', { exact: true }).fill('A little discovery: woodland wildlife');
  await page.getByLabel('Deadline · your local time').fill('2035-10-01T12:00');
  await page
    .getByLabel('Question text', { exact: true })
    .fill('Which animal is most active at night?');
  for (const [letter, text] of [
    ['A', 'Owl'],
    ['B', 'Butterfly'],
    ['C', 'Squirrel'],
    ['D', 'Robin'],
  ]) {
    await page.getByLabel(`Option ${letter}`, { exact: true }).fill(text!);
  }
  await capture(page, `${prefix}-editor`);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await navigation.getByRole('button', { name: 'Classes', exact: true }).click();
  await page.getByRole('button', { name: 'English · Group A', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invite students', exact: true })).toBeVisible();
  await capture(page, `${prefix}-classes`);
  await navigation.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await capture(page, `${prefix}-account`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 800 });
  await navigation.getByRole('button', { name: 'Assignments', exact: true }).click();
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  await expect(page.getByLabel('Deadline · your local time')).toBeVisible();
  await capture(page, `${prefix}-narrow-editor`);
  await page.setViewportSize({ width: 768, height: 1024 });
  await capture(page, `${prefix}-tablet-editor`);
  expect(pageErrors).toEqual([]);
});
