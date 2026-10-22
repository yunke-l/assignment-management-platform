import { test, expect } from '@playwright/test';

test('account setup confirmation traps and restores focus without losing input', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Have an invitation? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Pending student');
  await page.getByLabel('Invitation code', { exact: true }).fill('pending-invitation');
  await page.getByLabel('Password', { exact: true }).fill('PendingPassword123!');
  const switchMode = page.getByRole('button', { name: 'Already have an account? Sign in' });
  await switchMode.click();
  const dialog = page.getByRole('dialog', { name: 'Leave account setup?' });
  const keepWorking = dialog.getByRole('button', { name: 'Keep working', exact: true });
  const leave = dialog.getByRole('button', { name: 'Go to sign in', exact: true });
  await expect(keepWorking).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(leave).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(keepWorking).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(switchMode).toBeFocused();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('PendingPassword123!');
  await switchMode.click();
  // A click outside a destructive confirmation must not discard the form.
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await leave.click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Have an invitation? Create an account' }).click();
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Pending student');
  await expect(page.getByLabel('Invitation code', { exact: true })).toHaveValue(
    'pending-invitation',
  );
});

test('sign-in disables inputs during a request and preserves them after failure', async ({
  page,
}) => {
  let releaseRequest!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route('**/api/auth/login', async (route) => {
    await released;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Check your email and password.' }),
    });
  });
  await page.goto('/');
  const email = page.getByLabel('Email', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  await email.fill('pending@example.test');
  await password.fill('IncorrectPassword123!');
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  try {
    await expect(page.getByRole('button', { name: 'Please wait…', exact: true })).toBeDisabled();
    await expect(email).toBeDisabled();
    await expect(password).toBeDisabled();
  } finally {
    releaseRequest();
  }
  await expect(page.getByRole('alert')).toContainText('Check your email and password.');
  await expect(email).toBeEnabled();
  await expect(email).toHaveValue('pending@example.test');
  await expect(password).toHaveValue('IncorrectPassword123!');
  await expect(page.getByRole('button', { name: 'Sign in →', exact: true })).toBeEnabled();
});
