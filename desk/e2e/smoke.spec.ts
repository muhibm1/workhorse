/**
 * Playwright-Electron smoke test (plan Task 15, spec section 8): launches the built app exactly
 * as a user would (`electron .` against the built `out/`, no dev server), pre-registers
 * `../examples/hello-service` through `PADDOCK_E2E_ADD_REPO` (main/index.ts reads it once at
 * startup -- see `preregisterE2eRepo`) so the test never has to drive a native folder-picker
 * dialog, and walks: Fleet renders with a card for that repo reading "Not onboarded" (it has no
 * `.workhorse/profile.yml`), then Settings shows a real `node` version string in Prerequisites.
 *
 * Requires `npm run build` to have produced `out/` first (`package.json`'s `main` points at
 * `./out/main/index.js`); this spec does not build it itself.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';

/** `desk/` -- this file lives at `desk/e2e/smoke.spec.ts`. Launching with this as `cwd` makes the
 *  `PADDOCK_E2E_ADD_REPO` relative path below resolve the same way regardless of where `npx
 *  playwright test` itself was invoked from. */
const APP_ROOT = resolve(__dirname, '..');

/** Relative to `APP_ROOT`, i.e. `desk/`: resolves to `WorkHorse/examples/hello-service`, a real
 *  fixture repo with no `.workhorse/profile.yml` (see `preregisterE2eRepo` in main/index.ts). */
const E2E_REPO = '../examples/hello-service';

test.describe('Paddock smoke', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: ['.'],
      cwd: APP_ROOT,
      env: { ...process.env, PADDOCK_E2E_ADD_REPO: E2E_REPO },
    });
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('Fleet renders with the pre-registered repo not onboarded', async () => {
    // The Fleet screen's own heading (Fleet.tsx renders "Repositories" once at least one repo is
    // registered), scoped to the screen so the rail's "Fleet" button never makes this ambiguous.
    // Was `.fleet-toolbar` until the Dracula redesign removed it; this spec was not re-run then.
    await expect(window.locator('.fleet-title')).toHaveText('Repositories', { timeout: 20_000 });
    await expect(window.getByText('Not onboarded')).toBeVisible({ timeout: 20_000 });
  });

  test('Studbook opens from the rail with its composer, whether or not a store is connected', async () => {
    await window.getByRole('button', { name: 'Studbook' }).click();
    await expect(window.locator('.app-crumb-current')).toHaveText('Studbook', { timeout: 20_000 });
    // The question box is always present; the Connect panel only until a connection string is
    // stored, which a developer's own profile may already have -- so that is not asserted.
    await expect(window.locator('#studbook-question')).toBeVisible({ timeout: 20_000 });
    await expect(window.locator('.studbook-orb canvas')).toBeVisible();
  });

  test('Settings shows a real node version in Prerequisites', async () => {
    // Exact: the Studbook screen (visited by the test above) offers an "Open Settings" button,
    // which a substring match would also resolve to.
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    const nodeRow = window.locator('.settings-prereq-row', { hasText: 'node' });
    await expect(nodeRow).toBeVisible({ timeout: 20_000 });
    await expect(nodeRow.locator('.tnum')).toHaveText(/^v\d+\.\d+\.\d+/);
  });
});
