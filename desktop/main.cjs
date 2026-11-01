const { app, BrowserWindow, dialog, nativeTheme, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createStaticServer } = require('./static-server.cjs');

const PRODUCT_NAME = 'TACTICA FC';
const APP_ID = 'com.tacticafc.manager';
const APP_PORT = 51842; // Stable origin keeps IndexedDB career saves between launches.
const EXTERNAL_HOSTS = new Set(['github.com']);
const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  app.setName(PRODUCT_NAME);
  app.setAppUserModelId(APP_ID);
  nativeTheme.themeSource = 'dark';

  let server = null;
  let mainWindow = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const projectRoot = path.resolve(__dirname, '..');
      const webRoot = app.isPackaged
        ? path.join(app.getAppPath(), 'dist', 'tactica-manager')
        : path.join(projectRoot, 'dist', 'tactica-manager');
      if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
        throw new Error(`TACTICA web build not found: ${webRoot}. Run npm run build first.`);
      }
      server = createStaticServer(webRoot);
      await listen(server, APP_PORT);
      createMainWindow(`http://127.0.0.1:${APP_PORT}`);
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        title: `${PRODUCT_NAME} could not start`,
        message: 'The TACTICA FC game interface could not be started.',
        detail: error.message,
        buttons: ['Close'],
      });
      app.quit();
    }
  });

  app.on('before-quit', () => server?.close());
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server?.listening) {
      createMainWindow(`http://127.0.0.1:${APP_PORT}`);
    }
  });

  function createMainWindow(origin) {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    const icon = path.join(
      app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', 'public', 'tactica-brand'),
      app.isPackaged ? 'TACTICA_FC.ico' : 'Tactica_FC_Black_Metal.ico',
    );
    mainWindow = new BrowserWindow({
      title: PRODUCT_NAME,
      width: 1440,
      height: 960,
      minWidth: 960,
      minHeight: 680,
      backgroundColor: '#08090c',
      autoHideMenuBar: true,
      icon,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: !app.isPackaged,
      },
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url);
        if (target.protocol === 'https:' && EXTERNAL_HOSTS.has(target.hostname)) void shell.openExternal(target.href);
      } catch { /* reject malformed or non-HTTPS targets */ }
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!isLocalGameUrl(url, origin)) event.preventDefault();
    });
    mainWindow.webContents.on('will-redirect', (event, url) => {
      if (!isLocalGameUrl(url, origin)) event.preventDefault();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    void mainWindow.loadURL(`${origin}/tr`);
  }

  function isLocalGameUrl(candidate, origin) {
    try { return new URL(candidate).origin === origin; }
    catch { return false; }
  }
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(new Error(
      `Could not bind the local TACTICA web server to 127.0.0.1:${port}: ${error.message}`,
    ));
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}
