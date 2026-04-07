'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { router: browserRouter } = require('./lib/fileBrowser');
const { router: parserRouter } = require('./lib/logParser');
const { router: evtxRouter } = require('./lib/evtxParser');
const attachTailWatcher = require('./lib/tailWatcher');

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: false });

// Body parsers
app.use(express.text({ limit: '100mb', type: 'text/*' }));
app.use(express.json({ limit: '10mb' }));

// Serve socket.io client bundle
app.get('/socket.io.min.js', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.min.js')
  );
});

// API routes
app.use(browserRouter);
app.use(parserRouter);
app.use(evtxRouter);

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Attach real-time tail watcher
attachTailWatcher(io);

httpServer.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`AICMTrace running at ${url}`);

  // When packaged as a standalone executable, auto-open the browser
  if (typeof process.pkg !== 'undefined') {
    const { exec } = require('child_process');
    const open = process.platform === 'win32'  ? `start ${url}`
               : process.platform === 'darwin' ? `open ${url}`
               : `xdg-open ${url}`;
    exec(open);
  }
});
