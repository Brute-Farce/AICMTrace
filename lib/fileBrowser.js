'use strict';

const fs = require('fs');
const path = require('path');
const { Router } = require('express');

const LOG_EXTENSIONS = new Set(['.log', '.txt', '.lo_', '.out', '.err', '.trace', '.evtx']);

function getDriveRoots() {
  // On Windows, try common drive letters
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const drive = String.fromCharCode(i) + ':\\';
    try {
      fs.accessSync(drive, fs.constants.F_OK);
      drives.push(drive);
    } catch (_) {}
  }
  return drives.length > 0 ? drives : ['/'];
}

function browsePath(dirPath) {
  const normalized = path.normalize(dirPath);
  const stat = fs.statSync(normalized);
  if (!stat.isDirectory()) throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' });

  const rawEntries = fs.readdirSync(normalized, { withFileTypes: true });
  const entries = rawEntries
    .map(entry => {
      const ext = path.extname(entry.name).toLowerCase();
      return {
        name: entry.name,
        isDir: entry.isDirectory(),
        ext,
        isLog: !entry.isDirectory() && LOG_EXTENSIONS.has(ext)
      };
    })
    .filter(e => e.isDir || e.isLog)
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  const parentPath = path.dirname(normalized);
  const parent = parentPath !== normalized ? parentPath : null;

  return { current: normalized, parent, entries };
}

const router = Router();

router.get('/api/browse', (req, res) => {
  const dirPath = req.query.path;

  if (!dirPath) {
    // Return drive roots
    const roots = getDriveRoots();
    return res.json({
      current: null,
      parent: null,
      entries: roots.map(r => ({ name: r, isDir: true, ext: '', isLog: false })),
      isRoot: true
    });
  }

  try {
    const result = browsePath(dirPath);
    res.json(result);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Path not found' });
    if (err.code === 'EACCES') return res.status(403).json({ error: 'Access denied' });
    if (err.code === 'ENOTDIR') return res.status(400).json({ error: 'Not a directory' });
    throw err;
  }
});

module.exports = { router };
