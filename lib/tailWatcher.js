'use strict';

const fs = require('fs');
const chokidar = require('chokidar');
const { parseContent } = require('./logParser');
const { readChannelSince } = require('./evtxParser');

const CHANNEL_POLL_MS = 5000;

module.exports = function attachTailWatcher(io) {
  // Per-socket state
  const watchers = new Map();

  function clearState(state) {
    if (state.watcher) { state.watcher.close(); state.watcher = null; }
    if (state.timer)   { clearInterval(state.timer); state.timer = null; }
    state.filePath    = null;
    state.channelName = null;
    state.offset      = 0;
    state.sinceIso    = null;
  }

  io.on('connection', socket => {
    watchers.set(socket.id, { watcher: null, timer: null, filePath: null, channelName: null, offset: 0, sinceIso: null });

    // ── File tail ─────────────────────────────────────────────────────────
    socket.on('watch', ({ path: filePath }) => {
      const state = watchers.get(socket.id);
      if (!state) return;
      clearState(state);

      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return;
        state.filePath = filePath;
        state.offset   = stat.size;

        const watcher = chokidar.watch(filePath, {
          persistent: true,
          usePolling: false,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
        });

        watcher.on('change', changedPath => {
          try {
            const newStat = fs.statSync(changedPath);
            if (newStat.size <= state.offset) state.offset = 0;
            if (newStat.size === state.offset) return;

            const chunks = [];
            const stream = fs.createReadStream(changedPath, {
              start: state.offset,
              end: newStat.size - 1,
              encoding: 'utf8'
            });
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => {
              state.offset = newStat.size;
              const newContent = chunks.join('');
              if (!newContent.trim()) return;
              const entries = parseContent(newContent);
              if (entries.length) socket.emit('log:lines', { entries });
            });
            stream.on('error', () => {});
          } catch (_) {}
        });

        state.watcher = watcher;
      } catch (err) {
        socket.emit('error', { message: 'Cannot watch file: ' + err.message });
      }
    });

    // ── Live channel polling ──────────────────────────────────────────────
    socket.on('watch:channel', ({ channel, since }) => {
      const state = watchers.get(socket.id);
      if (!state) return;
      clearState(state);

      state.channelName = channel;
      state.sinceIso    = since || new Date().toISOString();

      state.timer = setInterval(async () => {
        try {
          const entries = await readChannelSince(state.channelName, state.sinceIso);
          if (!entries.length) return;
          // Advance the cursor to the latest timestamp
          const last = entries[entries.length - 1];
          if (last.isoTime) state.sinceIso = last.isoTime;
          socket.emit('log:lines', { entries });
        } catch (_) {}
      }, CHANNEL_POLL_MS);
    });

    // ── Stop watching ─────────────────────────────────────────────────────
    socket.on('unwatch', () => {
      const state = watchers.get(socket.id);
      if (state) clearState(state);
    });

    socket.on('disconnect', () => {
      const state = watchers.get(socket.id);
      if (state) clearState(state);
      watchers.delete(socket.id);
    });
  });
};
