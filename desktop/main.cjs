const { app, BrowserWindow, dialog, nativeTheme, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const PRODUCT_NAME = 'TACTICA FC';
const APP_ID = 'com.tacticafc.manager';
const BACKEND_READY_TIMEOUT_MS = 60_000;
const EXTERNAL_HOSTS = new Set(['github.com', 'open-football.org', 'www.open-football.org']);
const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  app.setName(PRODUCT_NAME);
  app.setAppUserModelId(APP_ID);
  nativeTheme.themeSource = 'dark';

  let backend = null;
  let backendLog = null;
  let mainWindow = null;
  let isQuitting = false;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const port = await reserveLoopbackPort();
      const origin = `http://127.0.0.1:${port}`;
      startBackend(port);
      await waitForBackend(backend, `${origin}/tr`);
      createMainWindow(origin);
    } catch (error) {
      const logPath = path.join(app.getPath('appData'), PRODUCT_NAME, 'desktop-backend.log');
      await dialog.showMessageBox({
        type: 'error',
        title: `${PRODUCT_NAME} başlatılamadı`,
        message: 'Yerel oyun motoru başlatılamadı.',
        detail: `${error.message}\n\nAyrıntı günlüğü: ${logPath}`,
        buttons: ['Kapat'],
      });
      app.quit();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopBackend();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && backend && backend.exitCode === null) {
      createMainWindow(`http://127.0.0.1:${backendPort}`);
    }
  });

  let backendPort = null;

  function startBackend(port) {
    const projectRoot = path.resolve(__dirname, '..');
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'open_football.exe')
      : path.join(projectRoot, 'vendor', 'open-football', 'target', 'desktop', 'fast', 'open_football.exe');

    if (!fs.existsSync(executable)) {
      throw new Error(`Oyun motoru bulunamadı: ${executable}\nÖnce npm run build komutunu çalıştırın.`);
    }

    const dataDirectory = path.join(app.getPath('appData'), PRODUCT_NAME);
    fs.mkdirSync(dataDirectory, { recursive: true });
    const logPath = path.join(dataDirectory, 'desktop-backend.log');
    backendLog = fs.createWriteStream(logPath, { flags: 'a' });
    backendPort = port;

    backend = spawn(executable, ['--match-events', '--match-threads=4'], {
      cwd: app.isPackaged ? dataDirectory : projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TACTICA_PORT: String(port),
        TACTICA_BIND_ADDRESS: '127.0.0.1',
        TACTICA_DATA_DIR: dataDirectory,
        TACTICA_NO_BROWSER: '1',
        OPEN_FOOTBALL_SKIP_MATCH_VIEWER: '1',
        MATCH_PLAY_POOL_MAX_THREADS: '4',
        MATCH_STORE_POOL_MAX_THREADS: '2',
      },
    });

    backend.stdout.pipe(backendLog, { end: false });
    backend.stderr.pipe(backendLog, { end: false });
    backend.on('error', (error) => backendLog?.write(`\n[spawn error] ${error.stack ?? error}\n`));
    backend.on('exit', (code, signal) => {
      backendLog?.write(`\n[engine exit] code=${code} signal=${signal}\n`);
      if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
        void dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: `${PRODUCT_NAME} kapandı`,
          message: 'Yerel oyun motoru beklenmedik şekilde durdu.',
          detail: `Ayrıntı günlüğü: ${logPath}`,
          buttons: ['Kapat'],
        }).then(() => app.quit());
      }
    });
  }

  function createMainWindow(origin) {
    if (mainWindow && !mainWindow.isDestroyed()) return;

    const icon = path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', 'public', 'tactica-brand'),
      app.isPackaged ? 'TACTICA_FC.ico' : 'Tactica_FC_Black_Metal.ico');
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
        if (target.protocol === 'https:' && EXTERNAL_HOSTS.has(target.hostname)) {
          void shell.openExternal(target.href);
        }
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

  function stopBackend() {
    if (backend && backend.exitCode === null && !backend.killed) backend.kill();
    backendLog?.end();
    backendLog = null;
  }
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForBackend(child, url) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + BACKEND_READY_TIMEOUT_MS;
    let settled = false;
    let timer = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      error ? reject(error) : resolve();
    };
    const onExit = (code, signal) => finish(new Error(`Oyun motoru hazır olmadan kapandı (code=${code}, signal=${signal}).`));
    const onError = (error) => finish(new Error(`Oyun motoru başlatılamadı: ${error.message}`));
    child.once('exit', onExit);
    child.once('error', onError);

    const retry = () => {
      if (settled) return;
      if (Date.now() >= deadline) return finish(new Error('Oyun motoru 60 saniye içinde hazır olmadı.'));
      timer = setTimeout(probe, 500);
    };
    const probe = () => {
      if (child.exitCode !== null) return onExit(child.exitCode, null);
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 400) finish();
        else retry();
      });
      request.setTimeout(1500, () => request.destroy(new Error('Yerel motor yanıt vermedi.')));
      request.on('error', retry);
    };

    probe();
  });
}
