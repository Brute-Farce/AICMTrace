'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const net  = require('net');
const http = require('http');

let mainWindow  = null;
let serverPort  = 3000;

// ── Single instance ────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Find a free TCP port ───────────────────────────────────────────────────
function findFreePort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(findFreePort(port + 1)));
    srv.once('listening', () => srv.close(() => resolve(port)));
    srv.listen(port, '127.0.0.1');
  });
}

// ── Start Express server ───────────────────────────────────────────────────
function startServer() {
  // When packaged (asar:false), app files live under resources/app/
  // In dev they're at the project root.
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'server.js')
    : path.join(__dirname, '..', 'server.js');
  require(serverPath);
}

// ── Poll until the HTTP server responds ────────────────────────────────────
function waitForServer(port, callback) {
  const check = () => {
    const req = http.get(`http://127.0.0.1:${port}/`, callback);
    req.on('error', () => setTimeout(check, 100));
    req.end();
  };
  check();
}

// ── Create main BrowserWindow ──────────────────────────────────────────────
function createWindow(port) {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'build', 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.ico');

  mainWindow = new BrowserWindow({
    width:    1400,
    height:   900,
    minWidth: 900,
    minHeight:600,
    title:    'AICMTrace',
    icon:     iconPath,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
    show: false, // revealed in 'ready-to-show'
  });

  // No native menu bar
  Menu.setApplicationMenu(null);

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Open any non-local URL in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  serverPort = await findFreePort(3000);
  process.env.PORT = String(serverPort);
  startServer();
  waitForServer(serverPort, () => createWindow(serverPort));
});

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (!mainWindow) waitForServer(serverPort, () => createWindow(serverPort));
});
