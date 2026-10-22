import { test, expect } from '@playwright/test';

test('themed menus support keyboard selection and uploads retain accessible file inputs', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('teacher@example.test');
  await page.getByLabel('Password', { exact: true }).fill('LocalStudy2026!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await page.getByRole('button', { name: '+ New assignment', exact: true }).click();
  const type = page.getByRole('combobox', { name: 'Question type', exact: true });
  await type.click();
  await expect(page.getByRole('option', { name: 'Single choice', exact: true })).toHaveAttribute(
    'data-combobox-active',
  );
  await page.screenshot({ path: `test-results/${info.project.name}-controls-dropdown.png` });
  await type.press('ArrowDown');
  await type.press('Enter');
  await page.getByRole('button', { name: 'Change type', exact: true }).click();
  await expect(type).toHaveValue('Fill in the blanks');
  await page.getByRole('button', { name: 'Add blank', exact: true }).click();
  const checkbox = page.getByRole('checkbox', { name: 'Case sensitive', exact: true });
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await page
    .locator('.editor-tools')
    .getByText('Add media or more text', { exact: true })
    .first()
    .click();
  const imageButton = page.getByRole('button', { name: 'Upload image', exact: true }).first();
  await expect(imageButton).toBeDisabled();
  await expect(page.getByLabel('Upload image', { exact: true }).first()).toHaveAttribute(
    'type',
    'file',
  );
  await page.getByLabel('Title', { exact: true }).fill('Themed component check');
  await page.getByLabel('Deadline date', { exact: true }).fill('2035-10-01');
  await page.getByLabel('Deadline time', { exact: true }).fill('12:00');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/assignments') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save and keep editing', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(imageButton).toBeEnabled();
  await imageButton.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/${info.project.name}-controls-upload.png` });
  const fileChooser = page.waitForEvent('filechooser');
  await imageButton.click();
  await (await fileChooser).setFiles([]);
  await expect(imageButton).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
