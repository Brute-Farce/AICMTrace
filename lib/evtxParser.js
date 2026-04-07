'use strict';

const { execFile } = require('child_process');
const { Router } = require('express');

const WEVTUTIL = 'wevtutil.exe';
const MAX_BUF  = 50 * 1024 * 1024; // 50 MB

// ── Parse wevtutil text-format output ─────────────────────────────────────
function parseWevtutilText(text) {
  if (!text || !text.trim()) return [];
  const entries = [];
  // Split on "Event[N]" lines — the header line itself is discarded
  const blocks = text.split(/^Event\[\d+\]\r?\n/m);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const entry = parseEventBlock(block);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseEventBlock(block) {
  const lines = block.split(/\r?\n/);
  const fields = {};
  let transitioned = false;
  const descLines = [];

  for (const line of lines) {
    if (!transitioned) {
      if (line.startsWith('  ')) {
        // Indented field line: "  Key Name: Value"
        const m = line.match(/^  ([^:]+):\s*(.*)/);
        if (m) fields[m[1].trim()] = m[2].trim();
      } else {
        // Blank line or col-0 content → beginning of description body
        transitioned = true;
        if (line.trim()) descLines.push(line);
      }
    } else {
      descLines.push(line);
    }
  }

  // Remove leading/trailing blank lines from description
  while (descLines.length && !descLines[0].trim()) descLines.shift();
  while (descLines.length && !descLines[descLines.length - 1].trim()) descLines.pop();

  const rawDate = fields['Date'] || '';
  let date = '', time = '', isoTime = rawDate;

  // Date field: "2026-03-24T06:07:47.5890000Z"
  const dm = rawDate.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (dm) { date = dm[1]; time = dm[2]; }

  const levelStr = (fields['Level'] || 'Information').trim();
  let type = 1;
  if (levelStr === 'Error' || levelStr === 'Critical') type = 3;
  else if (levelStr === 'Warning') type = 2;

  const message = descLines.join('\n').trim();

  return {
    message,
    time,
    date,
    component : fields['Source']   || '',
    thread    : fields['Task']     || fields['Task Category'] || '',
    type,
    typeName  : levelStr,
    file      : '',
    format    : 'evtx',
    raw       : block.trim(),
    isoTime,                           // full ISO timestamp for XPath polling
    eventId   : fields['Event ID'] || '',
    channel   : fields['Log Name'] || '',
    computer  : fields['Computer'] || '',
    user      : fields['User']     || '',
    keywords  : fields['Keyword']  || fields['Keywords'] || '',
  };
}

// ── wevtutil runners ───────────────────────────────────────────────────────
function run(args) {
  return new Promise((resolve, reject) => {
    execFile(WEVTUTIL, args, { maxBuffer: MAX_BUF, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && err.code === 5)
          return reject(Object.assign(new Error('Access denied (run as admin for Security log)'), { code: 'EACCES' }));
        if (err && !stdout)
          return reject(new Error((stderr || err.message).trim().replace(/\0/g, '')));
        // Strip null bytes that appear when wevtutil outputs UTF-16 read as UTF-8
        resolve((stdout || '').replace(/\0/g, ''));
      });
  });
}

// Read last N events from an .evtx file (chronological order)
async function readEvtxFile(filePath, count = 1000) {
  const out = await run(['qe', filePath, '/lf:true', '/f:text', '/rd:true', '/c:' + count]);
  return parseWevtutilText(out).reverse();
}

// Read last N events from a named channel (chronological order)
async function readChannel(channelName, count = 1000) {
  const out = await run(['qe', channelName, '/f:text', '/rd:true', '/c:' + count]);
  return parseWevtutilText(out).reverse();
}

// Read events newer than sinceIso from a named channel
async function readChannelSince(channelName, sinceIso) {
  const xpath = `*[System[TimeCreated[@SystemTime>'${sinceIso}']]]`;
  const out = await run(['qe', channelName, '/f:text', '/q:' + xpath]);
  return parseWevtutilText(out); // already oldest-first without /rd
}

// List all available channels
async function listChannels() {
  const out = await run(['el']);
  return out.split(/\r?\n/).map(l => l.trim()).filter(Boolean).sort();
}

// ── Express routes ─────────────────────────────────────────────────────────
const router = Router();

router.get('/api/evtx', async (req, res) => {
  const { path: filePath, channel, count } = req.query;
  const n = Math.min(parseInt(count, 10) || 1000, 5000);
  try {
    let entries;
    if (filePath)       entries = await readEvtxFile(filePath, n);
    else if (channel)   entries = await readChannel(channel, n);
    else return res.status(400).json({ error: 'path or channel parameter required' });
    res.json({ entries });
  } catch (err) {
    const status = err.code === 'EACCES' ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get('/api/evtx/channels', async (req, res) => {
  try {
    const channels = await listChannels();
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, readChannelSince };
