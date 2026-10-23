import { test, expect } from '@playwright/test';

test('registration explains malformed invitation codes before sending and allows correction', async ({
  page,
}) => {
  const registrations: { invitation: string }[] = [];
  const unavailable =
    'Invitation is invalid, expired, revoked or fully used. Ask your teacher or administrator for a new code.';
  await page.route('**/api/auth/register', async (route) => {
    registrations.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { message: unavailable } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Have an invitation? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('New Student');
  await page.getByLabel('Email', { exact: true }).fill('new-student@example.test');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('Registration123!');
  const invitation = page.getByLabel('Invitation code', { exact: true });
  for (const code of ['short-code', 'A'.repeat(42) + '!', 'A'.repeat(44)]) {
    await invitation.fill(code);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(invitation).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('43 letters, numbers, hyphens');
    await expect(page.getByRole('alert')).toContainText('teacher or administrator');
    await expect(page.getByRole('alert')).not.toContainText('pattern');
    expect(registrations).toHaveLength(0);
  }
  const code = 'Ab9_-'.repeat(8) + 'xyz';
  await invitation.fill(`  ${code}  `);
  await expect(invitation).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(unavailable);
  expect(registrations).toEqual([
    {
      invitation: code,
      email: 'new-student@example.test',
      name: 'New Student',
      password: 'Registration123!',
    },
  ]);
  await expect(password).toHaveValue('Registration123!');
  await expect(invitation).toBeEnabled();
});

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
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
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
