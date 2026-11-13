import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Fixture = {
  users: Record<string, { id: string; session: { access_token: string; user: Record<string, unknown>; [key: string]: unknown } }>;
  course: { id: string; code: string; name: string; term: string; offering_id: string };
};
const fixture = JSON.parse(readFileSync(process.env.CAMPUSMY_MEMBER_FIXTURE!, 'utf8')) as Fixture;
const WEB = 'http://127.0.0.1:3001';
const API = 'http://127.0.0.1:8001/api/v1';

async function memberContext(browser: Browser, name: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await setMemberSession(context, name);
  return context;
}

async function setMemberSession(context: BrowserContext, name: string) {
  await context.clearCookies();
  await context.unroute('https://test-project.supabase.co/**');
  const { session } = fixture.users[name];
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  // This is @supabase/ssr's supported cookie storage encoding. Credentials belong
  // only to an ephemeral test issuer; production rejects inline fixture keys.
  await context.addCookies([{ name: 'sb-test-project-auth-token', value, url: WEB, sameSite: 'Lax' }]);
  await context.route('https://test-project.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/user')) return route.fulfill({ json: session.user });
    if (path.endsWith('/token')) return route.fulfill({ json: session });
    if (path.endsWith('/logout')) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 400, json: { error: 'Unexpected simulated-provider request', path } });
  });
}

async function apiAs(name: string, path: string, init: RequestInit = {}) {
  const response = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${fixture.users[name].session.access_token}`, 'Content-Type': 'application/json', ...init.headers } });
  const result = response.status === 204 ? undefined : await response.json();
  expect(response.ok, JSON.stringify(result)).toBeTruthy();
  return result;
}

async function openCourse(page: Page) {
  await page.goto(`/courses/${fixture.course.id}`);
  await expect(page.getByRole('heading', { level: 1, name: fixture.course.name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write a review', exact: false }).first()).toBeVisible();
}

async function moderate(page: Page, body: string, action = 'Approve') {
  await page.goto('/admin');
  const row = page.locator('.moderation-item').filter({ has: page.getByText(body, { exact: true }) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason for the decision').fill('Checked this contribution under the community rules.');
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Moderation decision recorded.', { exact: true })).toBeVisible();
}

test('real signed member sessions load account data while unverified accounts stay gated', async ({ browser }) => {
  const verified = await memberContext(browser, 'alice');
  const unverified = await memberContext(browser, 'unverified');
  try {
    const page = await verified.newPage();
    await page.goto('/account');
    await expect(page.locator('#main-content').getByText('UTAR email verified', { exact: true })).toBeVisible();
    await expect(page.getByText(/Role: member/)).toBeVisible();
    await expect(page.getByText(/Expires /)).not.toContainText('1970');
    const other = await unverified.newPage();
    await other.goto(`/courses/${fixture.course.id}`);
    await expect(other.getByRole('link', { name: /Verify UTAR email/ })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Write a review', exact: false })).toHaveCount(0);
  } finally { await verified.close(); await unverified.close(); }
});

test('real member review, moderation, helpful vote, comment, tip and report roundtrip', async ({ browser }) => {
  const alice = await memberContext(browser, 'alice');
  const bob = await memberContext(browser, 'bob');
  const moderator = await memberContext(browser, 'moderator');
  try {
    const a = await alice.newPage(), b = await bob.newPage(), m = await moderator.newPage();
    const review = 'Member browser review: weekly exercises made the programming concepts clearer.';
    const comment = 'Member browser comment: did the practical exercises help with revision?';
    const tip = 'Member browser tip: practise tracing small programs and explain each state change.';
    await openCourse(a);
    await a.getByRole('button', { name: 'Write a review', exact: false }).first().click();
    let dialog = a.getByRole('dialog');
    await dialog.getByLabel('Trimester').fill(fixture.course.term);
    await dialog.getByLabel('Your experience').fill(review);
    await dialog.getByLabel('Advice for future students').fill('Start the exercises early and ask questions during tutorials.');
    await dialog.getByLabel('Overall experience').selectOption('4');
    await dialog.getByRole('button', { name: 'Submit for review' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(a.getByText('Your contribution was submitted for moderation.', { exact: true })).toBeVisible();
    await a.goto('/account');
    const own = a.locator('.own-content').filter({ hasText: review });
    await expect(own).toBeVisible();
    await expect(own.getByText('pending', { exact: true })).toBeVisible();
    await moderate(m, review);
    await openCourse(b);
    let card = b.locator('.review-card').filter({ hasText: review });
    await expect(card).toBeVisible();
    await expect(card.locator('time')).not.toContainText('1970');
    await card.getByRole('button', { name: /Helpful/ }).click();
    await expect(card.getByRole('button', { name: /Helpful · 1/ })).toBeVisible();
    await card.getByRole('button', { name: 'Comments', exact: true }).click();
    await card.getByLabel('Write a comment').fill(comment);
    await card.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(b.getByText('Comment submitted. It may need approval before appearing.', { exact: true })).toBeVisible();
    await moderate(m, comment);
    await openCourse(a);
    card = a.locator('.review-card').filter({ hasText: review });
    await card.getByRole('button', { name: 'Comments', exact: true }).click();
    await expect(card.getByText(comment, { exact: true })).toBeVisible();
    await a.getByRole('tab', { name: 'Exam tips', exact: true }).click();
    await a.getByRole('button', { name: 'Write an exam tip', exact: false }).first().click();
    dialog = a.getByRole('dialog');
    await dialog.getByLabel('Trimester').fill(fixture.course.term);
    await dialog.getByLabel('Format and preparation advice').fill(tip);
    await dialog.getByRole('button', { name: 'Submit for review' }).click();
    await expect(dialog).not.toBeVisible();
    await moderate(m, tip);
    await openCourse(b);
    await b.getByRole('tab', { name: 'Exam tips', exact: true }).click();
    const tipCard = b.locator('.review-card').filter({ hasText: tip });
    await expect(tipCard).toBeVisible();
    await tipCard.getByRole('button', { name: 'Report', exact: true }).click();
    dialog = b.getByRole('dialog');
    await dialog.getByLabel('Reason').selectOption('wrong_context');
    await dialog.getByLabel('Details').fill('Testing the report flow against the real moderation API.');
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(b.getByText('Your report was sent privately.', { exact: true })).toBeVisible();
    await moderate(m, tip, 'Hide');
    await b.reload();
    await b.getByRole('tab', { name: 'Exam tips', exact: true }).click();
    await expect(b.getByText(tip, { exact: true })).toHaveCount(0);
    const feed = await apiAs('bob', `/courses/${fixture.course.id}/reviews`);
    expect(feed.total).toBe(1);
    expect(feed.items[0].helpful_count).toBe(1);
    for (const user of Object.values(fixture.users)) expect(JSON.stringify(feed)).not.toContain(user.id);
  } finally { await alice.close(); await bob.close(); await moderator.close(); }
});

test('private account timetable survives a second browser and stale-device save is rejected', async ({ browser }) => {
  const first = await memberContext(browser, 'alice');
  const second = await memberContext(browser, 'alice');
  try {
    const a = await first.newPage(), b = await second.newPage();
    await openCourse(a);
    const offering = a.locator('.offering-card').filter({ has: a.getByRole('heading', { name: fixture.course.term, exact: true }) });
    await offering.getByRole('button', { name: 'Add to timetable', exact: false }).click();
    await a.goto('/timetable');
    await expect(a.getByRole('button', { name: 'Save to my account' })).toBeVisible();
    await expect(a.locator('.plan-entry').getByText(fixture.course.code, { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Save to my account' }).click();
    await expect(a.getByText('Timetable saved privately to your account.', { exact: true })).toBeVisible();
    const remote = await apiAs('alice', '/me/timetables');
    expect(remote.items).toHaveLength(1);
    expect(remote.items[0].entries[0].meetings.length).toBeGreaterThan(0);
    const bobPlans = await apiAs('bob', '/me/timetables');
    expect(bobPlans.items).toHaveLength(0);
    await b.goto('/timetable');
    await b.getByRole('button', { name: 'Open account timetables' }).click();
    await b.getByRole('dialog').getByRole('button', { name: 'Open', exact: true }).click();
    await expect(b.locator('.plan-entry').getByText(fixture.course.code, { exact: true })).toBeVisible();
    await expect(b.locator('.meeting').first()).toBeVisible();
    await a.getByRole('button', { name: 'Rename', exact: true }).click();
    await a.getByRole('dialog').getByLabel('Timetable name').fill('Updated on first device');
    await a.getByRole('dialog').getByRole('button', { name: 'Save name' }).click();
    const saved = a.waitForResponse(response => response.url().includes('/me/timetables/') && response.request().method() === 'PATCH');
    await a.getByRole('button', { name: 'Save to my account' }).click();
    expect((await saved).status()).toBe(200);
    const stale = b.waitForResponse(response => response.url().includes('/me/timetables/') && response.request().method() === 'PATCH');
    await b.getByRole('button', { name: 'Save to my account' }).click();
    expect((await stale).status()).toBe(409);
    await expect(b.locator('.error-state[role="alert"]')).toContainText('another device');
  } finally { await first.close(); await second.close(); }
});


test('switching accounts on one browser keeps private device plans separated', async ({ browser }) => {
  const context = await memberContext(browser, 'alice');
  try {
    const page = await context.newPage();
    await page.goto('/timetable');
    await expect(page.getByRole('button', { name: 'Save to my account' })).toBeVisible();
    await page.getByRole('button', { name: 'Manual event' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Event name').fill('Alice private library session');
    await dialog.getByRole('button', { name: 'Add event' }).click();
    await expect(page.locator('.plan-entry').getByText('Alice private library session', { exact: true })).toBeVisible();
    await setMemberSession(context, 'bob');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Save to my account' })).toBeVisible();
    await expect(page.locator('.plan-entry').getByText('Alice private library session', { exact: true })).toHaveCount(0);
    await setMemberSession(context, 'alice');
    await page.reload();
    await expect(page.locator('.plan-entry').getByText('Alice private library session', { exact: true })).toBeVisible();
  } finally { await context.close(); }
});
