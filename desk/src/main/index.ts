import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';

/** Renderer CSP (spec section 7). Keep identical to the meta tag in src/renderer/index.html. */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
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

function createWindow(): void {
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
}

void app.whenReady().then(() => {
  installCsp();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
