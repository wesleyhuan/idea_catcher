import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error('Set E2E_EMAIL and E2E_PASSWORD');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Capture')).toBeVisible();
}

test('capture → processed in inbox → done', async ({ page }) => {
  const token = `e2e-${Date.now()}`;
  await login(page);

  await page.getByLabel('Capture').fill(`記得買牛奶 buy milk ${token}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved ✓')).toBeVisible();

  await page.getByRole('link', { name: 'Inbox' }).click();
  const card = page.getByTestId('capture-card').first();
  await expect(card).toHaveAttribute('data-processing', 'done', { timeout: 45_000 });
  await card.click();
  await expect(page.getByText(token)).toBeAttached(); // raw text inside "Original capture"

  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Status').selectOption('done');
  await page.getByTestId('capture-card').first().click();
  await expect(page.getByText(token)).toBeAttached();
});

test('offline capture waits in the outbox and syncs on reconnect', async ({ page, context }) => {
  const token = `offline-${Date.now()}`;
  await login(page);

  await context.setOffline(true);
  await page.getByLabel('Capture').fill(`offline note ${token}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('1 waiting to sync')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('waiting to sync')).toHaveCount(0, { timeout: 20_000 });
});
