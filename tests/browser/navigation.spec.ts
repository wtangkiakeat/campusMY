import { expect, test } from '@playwright/test';

test('primary navigation reaches planner and courses at both screen sizes', async ({ page }) => {
  await page.goto('/courses');
  await expect(page.locator('.course-row').first()).toBeVisible();
  const openNavigation = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await openNavigation.isVisible()) await openNavigation.click();
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await navigation.getByRole('link', { name: /^(My timetable|Timetable)$/ }).click();
  await expect(page).toHaveURL(/\/timetable$/);
  await expect(page.getByRole('heading', { name: 'My timetable', exact: true })).toBeVisible();
  if (await openNavigation.isVisible()) await openNavigation.click();
  await navigation.getByRole('link', { name: /^(Course explorer|Courses)$/ }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.locator('.course-row').first()).toBeVisible();
});

test('layout remains within viewport on course detail and account screens', async ({ page }) => {
  await page.goto('/courses');
  await page.locator('.course-row').first().click();
  await expect(page.getByRole('heading', { name: 'Published classes' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
