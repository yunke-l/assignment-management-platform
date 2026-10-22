import { expect, type Locator } from '@playwright/test';

/** Exercise the real menu rather than assigning a hidden form value. */
export async function selectChoice(
  input: Locator,
  option: string | { label?: string; value?: string },
) {
  await input.click();
  const target = typeof option === 'string' ? { value: option } : option;
  const choices = input.page().getByRole('option');
  const choice =
    target.label !== undefined
      ? input.page().getByRole('option', { name: target.label, exact: true })
      : choices.and(input.page().locator(`[value=${JSON.stringify(target.value)}]`));
  await choice.click();
  await expect(choice).not.toBeVisible();
}

export async function selectChoiceWithKeyboard(input: Locator, label: string) {
  await input.focus();
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const choices = input.page().getByRole('option');
  const target = input.page().getByRole('option', { name: label, exact: true });
  for (let index = 0; index <= (await choices.count()); index++) {
    if ((await target.getAttribute('data-combobox-selected')) !== null) break;
    await input.press('ArrowDown');
  }
  await expect(target).toHaveAttribute('data-combobox-selected');
  await input.press('Enter');
  await expect(input).toHaveValue(label);
}
