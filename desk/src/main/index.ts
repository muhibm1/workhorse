import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron';
import { join, resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import { registerIpc } from './ipc';
import { createRegistry } from './registry';
import { createSettings, type CryptoLike } from './settings';
import { syscheck } from './syscheck';
import { digest, runWh } from './wh';
import { createWatcher } from './watcher';
import { driverFor } from './drivers';
import { createStudbook } from './studbook';

/**
 * Supabase's root certificate, which every Studbook database connection is verified against.
 * Ships as an extra resource next to the plugin and fonts (electron-builder.yml); in dev it is
 * read from the project's own `resources/studbook`, resolved the same way `resolvePluginPath` is.
 */
function resolveStudbookCaPath(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(base, 'studbook', 'supabase-ca.pem');
}

/** Renderer CSP (spec section 7). Keep identical to the meta tag in src/renderer/index.html. */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; "  +
  "img-src 'self' data:; font-src 'self'; connect-src 'none'";

/** Set by `electron-vite dev`; absent in a built app. */
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

function installCsp(): void {
  // In dev the Vite server owns the page's policy (see devCsp in electron.vite.config.ts); a strict
  // header here would block Fast Refresh and HMR. Built app: header and meta tag both carry it.
  if (devServerUrl) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
}

/**
 * Denies renderer-initiated navigation and window creation everywhere (spec 7: "No
 * shell.openExternal on untrusted strings; packet links open in the in-app viewer"; global
 * constraints: block navigation). Registered once, before any window loads content, so it covers
 * every `WebContents` the app ever creates -- the main window and any devtools contents alike.
 */
/** Nothing in Paddock needs camera, microphone, geolocation, notifications or clipboard reads.
 *  Denying every request outright means a future dependency cannot quietly acquire one. */
function installPermissionGuard(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (navEvent) => {
      navEvent.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

/**
 * The bundled plugin's location (spec 5.5). A `settings.pluginPath` override always wins; failing
 * that, a packaged app reads `process.resourcesPath/plugin` (electron-builder's `extraResources`
 * entry copies `resources/plugin` there -- see electron-builder.yml) and a dev run reads
 * `<app root>/resources/plugin`. `app.getAppPath()` is confirmed (not assumed -- checked by
 * launching this project's own `electron .` and logging `app.getAppPath()`) to equal the `desk/`
 * project root in both `electron-vite dev` and a plain `electron .` invocation, since Electron
 * resolves it from the nearest `package.json` to the `main` entry point, which is `desk/package.json`
 * itself; `resources/plugin` therefore sits directly under it with no `..` hop.
 */
function resolvePluginPath(override: string | null): string {
  if (override) return override;
  if (app.isPackaged) return join(process.resourcesPath, 'plugin');
  return join(app.getAppPath(), 'resources', 'plugin');
}

/**
 * `PADDOCK_E2E_ADD_REPO`: read once at startup, before the watcher starts, so a value pre-
 * registers a repo for Playwright's smoke test (e2e/smoke.spec.ts) without the renderer ever
 * driving a real filesystem picker. Relative paths resolve against `process.cwd()`, matching how
 * Playwright's `_electron.launch` inherits the test runner's working directory. Never touches the
 * registry when unset or when the path does not exist -- `registry.add` would throw either way,
 * and a bad e2e env var should fail loudly in the test, not silently no-op deep in main.
 */
function preregisterE2eRepo(registry: ReturnType<typeof createRegistry>): void {
  const raw = process.env['PADDOCK_E2E_ADD_REPO'];
  if (!raw) return;
  const path = resolvePath(process.cwd(), raw);
  if (!existsSync(path)) {
    console.error(`PADDOCK_E2E_ADD_REPO points at a path that does not exist: ${path}`);
    return;
  }
  registry.add(path);
}

function createCryptoLike(): CryptoLike {
  return {
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
    available: () => safeStorage.isEncryptionAvailable(),
  };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (devServerUrl) void win.loadURL(devServerUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

void app.whenReady().then(() => {
  installCsp();
  installNavigationGuards();
  installPermissionGuard();

  const win = createWindow();

  const userDataDir = app.getPath('userData');
  const registry = createRegistry(join(userDataDir, 'registry.json'));
  const settings = createSettings(userDataDir, createCryptoLike());
  const pluginPath = resolvePluginPath(settings.get().pluginPath);
  const watcher = createWatcher({ digest: (repoPath) => digest(pluginPath, repoPath) });

  preregisterE2eRepo(registry);

  // Models load on first use, not here: ~500 MB resident and a 1.5 GB first download is
  // Studbook's cost, not every launch's. Cached under userData so they live with the app's data.
  const studbook = createStudbook({
    readConninfo: () => settings.readStudbookConninfo(),
    readApiKey: () => settings.readApiKey(),
    caPath: resolveStudbookCaPath(),
    modelCacheDir: join(userDataDir, 'studbook-models'),
  });

  registerIpc({
    ipcMain,
    dialog,
    win,
    registry,
    settings,
    syscheck,
    watcher,
    driverFor,
    pluginPath,
    digest,
    runWh,
    safe: { readApiKey: () => settings.readApiKey() },
    studbook,
  });

  // Start watching every already-registered repo (including one PADDOCK_E2E_ADD_REPO just
  // added) so the Run screen's phase/gate state is never stale on launch (spec 5.3).
  for (const repo of registry.list()) watcher.watch(repo);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
