import { expect, test } from '@playwright/test';

test('real course search, catalogue scope, and honest empty states', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/courses');
  await expect(page.locator('.course-row').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.getByLabel('Search courses').fill('zzzz-no-real-course-941');
  await expect(page.getByRole('heading', { name: 'No matching courses' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('.course-row').first()).toBeVisible();
  await page.getByLabel('Trimester', { exact: true }).selectOption('');
  await expect(page.locator('.course-row').first()).toBeVisible();
  await page.getByLabel('Campus', { exact: true }).selectOption('Sungai Long');
  await expect(page.locator('.course-row').first()).toBeVisible();
  await page.getByLabel('Trimester', { exact: true }).selectOption('October 2026');
  await expect(page.getByRole('heading', { name: 'No matching courses' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a sourced course adds real selected meetings and persists after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/courses');
  const row = page.locator('.course-row').first();
  await expect(row).toBeVisible();
  const code = await row.locator('.course-code').innerText();
  await row.click();
  await expect(page.getByRole('heading', { name: 'Published classes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Official source' }).first()).toHaveAttribute('href', /^https:\/\/.*utar\.edu\.my\//);
  await expect(page.getByText('A conversation for UTAR students.')).toBeVisible();
  await page.getByRole('button', { name: 'Add to timetable' }).first().click();
  await expect(page.getByRole('button', { name: 'Added to timetable' }).first()).toBeDisabled();
  await page.goto('/timetable');
  await expect(page.locator('.plan-entry').filter({ hasText: code })).toHaveCount(1);
  await expect(page.locator('.meeting').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.plan-entry').filter({ hasText: code })).toHaveCount(1);
  await page.getByRole('button', { name: `Remove ${code}`, exact: true }).click();
  await expect(page.locator('.plan-entry')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('manual events validate times and preserve teaching-week clash semantics', async ({ page }) => {
  await page.goto('/timetable');
  await expect(page.getByRole('heading', { name: 'My timetable', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manual event' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Event name').fill('   ');
  await dialog.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(dialog.locator('.error-state')).toContainText(/name/i);
  await dialog.getByLabel('Event name').fill('Algorithms study session');
  await dialog.getByLabel('Start time').fill('22:00');
  await dialog.getByLabel('End time').fill('21:00');
  await dialog.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('End time must be after');
  await dialog.getByLabel('End time').fill('23:00');
  await dialog.getByLabel('Teaching weeks (optional)').fill('1');
  await dialog.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(page.locator('.plan-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Manual event' }).click();
  await dialog.getByLabel('Event name').fill('Different teaching week');
  await dialog.getByLabel('Start time').fill('22:00');
  await dialog.getByLabel('End time').fill('23:00');
  await dialog.getByLabel('Teaching weeks (optional)').fill('2');
  await dialog.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(page.locator('.plan-entry')).toHaveCount(2);
  await expect(page.locator('.clash-notice')).toHaveCount(0);
  await page.getByLabel('Teaching week', { exact: true }).selectOption('1');
  await expect(page.locator('.meeting')).toHaveCount(1);
  await page.getByLabel('Teaching week', { exact: true }).selectOption('all');
  await expect(page.locator('.meeting')).toHaveCount(2);
});

test('backup export, previewed merge, and invalid import keep the existing plan', async ({ page }) => {
  await page.goto('/timetable');
  await expect(page.getByRole('button', { name: 'Export backup' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  expect((await downloaded).suggestedFilename()).toBe('campusmy-timetables.json');
  await page.getByLabel('Import timetable backup').setInputFiles({
    name: 'malformed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ plans: [null] })),
  });
  await expect(page.locator('.error-state')).toContainText('not a valid CampusMY');
  const backup = { version: 3, plans: [{ id: 'imported-plan', name: 'Imported week', campus: 'Kampar', term: 'October 2026', entries: [] }] };
  await page.getByLabel('Import timetable backup').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByRole('dialog')).toContainText('ready to import');
  await page.getByRole('button', { name: 'Merge timetables' }).click();
  await expect(page.getByLabel('Select timetable').locator('option')).toHaveCount(2);
});

test('unconfigured authentication has honest setup state and protects member pages', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Sign-in is being connected.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('test-secret');
  await page.goto('/verify-university');
  await expect(page.getByRole('link', { name: /sign in/i }).last()).toBeVisible();
});

test('API failure shows recovery and does not crash the page', async ({ page }) => {
  await page.route('**/api/v1/courses?*', route => route.fulfill({
    status: 503,
    headers: { 'Access-Control-Allow-Origin': '*' },
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'Course service is temporarily unavailable.' }),
  }));
  await page.goto('/courses');
  await expect(page.locator('.error-state')).toContainText('temporarily unavailable');
  await page.unroute('**/api/v1/courses?*');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.course-row').first()).toBeVisible();
});

test('screen has no document overflow and keyboard search is usable', async ({ page }, testInfo) => {
  await page.goto('/courses');
  await expect(page.locator('.course-row').first()).toBeVisible();
  const availableCode = await page.locator('.course-row').first().locator('.course-code').innerText();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search courses')).toBeFocused();
  await page.keyboard.type(availableCode);
  await expect(page.getByLabel('Search courses')).toHaveValue(availableCode);
  await expect(page.locator('.course-row').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath(`courses-${testInfo.project.name}.png`), fullPage: true });
});
