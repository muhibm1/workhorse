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
    // The Fleet toolbar's own "Fleet" label, scoped past the left nav's identically-labelled
    // button (App.tsx renders both once the app is ready) so this assertion stays single-match.
    await expect(window.locator('.fleet-toolbar').getByText('Fleet', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(window.getByText('Not onboarded')).toBeVisible({ timeout: 20_000 });
  });

  test('Settings shows a real node version in Prerequisites', async () => {
    await window.getByRole('button', { name: 'Settings' }).click();
    const nodeRow = window.locator('.settings-prereq-row', { hasText: 'node' });
    await expect(nodeRow).toBeVisible({ timeout: 20_000 });
    await expect(nodeRow.locator('.tnum')).toHaveText(/^v\d+\.\d+\.\d+/);
  });
});
