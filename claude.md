# claude.md

This file provides guidance to Claude Code when working in this repository.

## Instructions
- Before making any changes to the main brach, create a new local branch. Sync that banch to git. 
- When a freature is complete, test the feature. Suggest proceedures for testing and request approval before merging with the main branch
- Before pulling into the main/master banch, get approval
- Always verify your work. Make sure you're using the optimized methods and that you have not introduced any new errors
- Ask clarifying questions where neccessary. 


## Project Overview

AICMTrace is a web-based log viewer inspired by CMTrace and OneTrace (Microsoft Configuration Manager tools). It runs as a local Node.js/Express server and opens in the browser. It is also packaged as a standalone Windows `.exe` via `@yao-pkg/pkg` and as an Electron desktop app.

Key capabilities:
- Parses multiple log formats: CMTrace (`<![LOG[`), Simple (`$$<`), CBS/DISM, Panther, timestamped, and plain text
- Reads Windows Event Log files (`.evtx`) and live Event Channels via `wevtutil.exe`
- Real-time log tailing via chokidar + socket.io
- Built-in Intune Diagnostics tab (IME log parser/timeline)
- Built-in DSRegCmd Analyzer tab (parses `dsregcmd /status` output)
- File browser sidebar for navigating local drives
- Virtual scrolling for large log files

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 5, socket.io 4
- **Language:** Vanilla JavaScript (no build step — CommonJS on server, plain JS in browser)
- **Styling:** Plain CSS (`public/style.css`) with CSS custom properties for theming
- **Package Manager:** npm
- **Desktop packaging:** Electron 33 + electron-builder
- **Standalone EXE packaging:** @yao-pkg/pkg

## Project Structure

```
server.js           Entry point — Express server + socket.io setup
lib/
  fileBrowser.js    /api/browse — local filesystem navigation
  logParser.js      /api/read, /api/parse — all text log format parsing
  evtxParser.js     /api/evtx, /api/evtx/channels — wevtutil-based EVTX parsing
  tailWatcher.js    socket.io events: watch / watch:channel / unwatch
public/
  index.html        Single-page app shell
  app.js            Log viewer tab — virtual scroll, filter, find, tail
  intuneTab.js      Intune Diagnostics tab
  dsregTab.js       DSRegCmd Analyzer tab
  errorCodes.js     Windows error code lookup table
  style.css         All styles + theme definitions
electron/
  main.js           Electron main process
build/
  icon.ico          App icon
featurereq.md       Backlog of CMTrace/OneTrace features not yet implemented
```

## Development Commands

```bash
npm install          # Install dependencies
npm start            # Run dev server at http://localhost:3000
npm run electron:dev # Run as Electron desktop app
npm run build        # Package as standalone Windows EXE (dist/AICMTrace.exe)
npm run build:electron # Build Electron installer (dist-electron/)
```

## Key Conventions

- No transpilation or bundler — browser code must be plain ES5-compatible JS (var, not const/let, no arrow functions in hot paths) to keep the existing style consistent.
- Server-side uses `'use strict'` and CommonJS (`require`/`module.exports`).
- All log entries share a common shape: `{ message, time, date, component, thread, type (1/2/3), typeName, file, format, raw }`.
- EVTX parsing shells out to `wevtutil.exe` — Windows only, no npm package needed.
- `errorCodes.js` is a large lookup table loaded in the browser; it is not a module.
