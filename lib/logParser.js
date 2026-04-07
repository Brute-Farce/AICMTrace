'use strict';

const fs = require('fs');
const { Router } = require('express');

// ── Severity helpers ──────────────────────────────────────────────────────────
const LEVEL_TYPE = {
  info:1, information:1, verbose:1, debug:1, trace:1, perf:1,
  warning:2, warn:2,
  error:3, err:3, fatal:3, critical:3
};
const TYPE_NAME = { 1:'Info', 2:'Warning', 3:'Error' };

function levelToType(s) { return LEVEL_TYPE[(s||'').toLowerCase()] || 1; }

function severityFromText(msg) {
  const lower = (msg||'').toLowerCase();
  if (/\berror\b|\bfail(ed|ure)?\b|\bcritical\b|\bfatal\b/.test(lower)) return 3;
  if (/\bwarn(ing)?\b/.test(lower)) return 2;
  return 1;
}

// ── CMTrace parser ────────────────────────────────────────────────────────────
const CCM_RE = /<!\[LOG\[([\s\S]*?)\]LOG\]!><time="([^"]+)" date="([^"]+)" component="([^"]*)" context="[^"]*" type="(\d)" thread="([^"]*)" file="([^"]*)"/g;

function parseCMTrace(content) {
  const entries = [];
  let m;
  CCM_RE.lastIndex = 0;
  while ((m = CCM_RE.exec(content)) !== null) {
    const [, message, time, date, component, type, thread, file] = m;
    const t = parseInt(type, 10);
    entries.push({ message:message.trim(), time, date, component, type:t, typeName:TYPE_NAME[t]||'Info', thread, file, format:'cmtrace', raw:m[0] });
  }
  return entries;
}

// ── Simple / $$< parser ───────────────────────────────────────────────────────
// Format: message$$<Component><MM-dd-YYYY HH:mm:ss.fff+TZ><thread=N (0xNN)>
const SIMPLE_RE = /^([\s\S]*?)\$\$<([^>]*)><([^>]*)><thread=(\d+)/;

function parseSimple(content) {
  const entries = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = SIMPLE_RE.exec(t);
    if (m) {
      const [, message, component, datetime] = m;
      const [datePart, timePart] = datetime.replace(/[+-]\d+$/, '').split(' ');
      const thread = m[4];
      const type = severityFromText(message);
      entries.push({ message:message.trim(), time:timePart||'', date:datePart||'', component:component.trim(), thread, type, typeName:TYPE_NAME[type], file:null, format:'simple', raw:line });
    } else {
      const type = severityFromText(t);
      entries.push({ message:t, time:null, date:null, component:null, thread:null, type, typeName:TYPE_NAME[type], file:null, format:'plain', raw:line });
    }
  }
  return entries;
}

// ── CBS / DISM parser ─────────────────────────────────────────────────────────
// Format: YYYY-MM-DD HH:MM:SS, Level    Component   Message
const CBS_STRICT = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\s+(\w+)\s{2,}(\S+)\s{2,}(.*)/;
const CBS_RELAX  = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\s+(\w+)\s+(.*)/;

function parseCBS(content) {
  const entries = [];
  let pending = null;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let m = CBS_STRICT.exec(t);
    if (m) {
      if (pending) entries.push(pending);
      const [, dt, level, component, message] = m;
      const [date, time] = dt.split(' ');
      const type = levelToType(level);
      pending = { message:message.trim(), time, date, component:component.trim(), thread:null, type, typeName:TYPE_NAME[type]||level, file:null, format:'cbs', raw:line };
      continue;
    }
    m = CBS_RELAX.exec(t);
    if (m) {
      if (pending) entries.push(pending);
      const [, dt, level, message] = m;
      const [date, time] = dt.split(' ');
      const type = levelToType(level);
      pending = { message:message.trim(), time, date, component:null, thread:null, type, typeName:TYPE_NAME[type]||level, file:null, format:'cbs', raw:line };
    } else if (pending) {
      pending.message += ' ' + t;
      pending.raw += '\n' + line;
    }
  }
  if (pending) entries.push(pending);
  return entries;
}

// ── Panther parser ────────────────────────────────────────────────────────────
// Format: YYYY-MM-DD HH:MM:SS, Level      Message (optional [ErrorCode])
const PANTHER_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\s+(\w+)\s+(.*)/;

function parsePanther(content) {
  const entries = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = PANTHER_RE.exec(t);
    if (m) {
      const [, dt, level, message] = m;
      const [date, time] = dt.split(' ');
      const type = levelToType(level);
      entries.push({ message:message.trim(), time, date, component:null, thread:null, type, typeName:TYPE_NAME[type]||level, file:null, format:'panther', raw:line });
    } else {
      const type = severityFromText(t);
      entries.push({ message:t, time:null, date:null, component:null, thread:null, type, typeName:TYPE_NAME[type], file:null, format:'plain', raw:line });
    }
  }
  return entries;
}

// ── Timestamped parser ────────────────────────────────────────────────────────
// Handles: ISO 8601, slash dates (US/EU), syslog, time-only, bracketed
const MONTH_ABBR = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

const TS_PATTERNS = [
  // ISO: 2024-01-15T14:30:00.123Z or 2024-01-15 14:30:00,456
  { re:/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:[+-]\d{2}:?\d{2}|Z)?)\s+(.*)/, dt:(m)=>({date:m[1],time:m[2].replace(',','.')}) },
  // Bracketed ISO: [2024-01-15T14:30:00] LEVEL: msg
  { re:/^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*)\]\s+(.*)/, dt:(m)=>{ const [d,t]=(m[1].replace('T',' ')).split(' '); return {date:d,time:t,rest:m[2]}; } },
  // Slash US: 01/15/2024 14:30:00
  { re:/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\s*(?:AM|PM)?)\s+(.*)/, dt:(m)=>({date:`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`,time:m[4]}) },
  // Syslog: Jan 15 14:30:00 host msg
  { re:/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+\S+\s+(.*)/, dt:(m,y)=>({date:`${y}-${String(MONTH_ABBR[m[1]]||1).padStart(2,'0')}-${m[2].padStart(2,'0')}`,time:m[3]}) },
  // Time-only: 14:30:00.123 msg
  { re:/^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.*)/, dt:(m)=>({date:null,time:m[1]}) },
];

function parseTimestamped(content) {
  const entries = [];
  const year = new Date().getFullYear();
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let matched = false;
    for (const p of TS_PATTERNS) {
      const m = p.re.exec(t);
      if (m) {
        const { date, time } = p.dt(m, year);
        // rest of line after timestamp
        const rest = m[m.length - 1] || '';
        const type = severityFromText(rest);
        entries.push({ message:rest.trim(), time:time||'', date:date||'', component:null, thread:null, type, typeName:TYPE_NAME[type], file:null, format:'timestamped', raw:line });
        matched = true;
        break;
      }
    }
    if (!matched) {
      const type = severityFromText(t);
      entries.push({ message:t, time:null, date:null, component:null, thread:null, type, typeName:TYPE_NAME[type], file:null, format:'plain', raw:line });
    }
  }
  return entries;
}

// ── Plain text ────────────────────────────────────────────────────────────────
function parsePlain(content) {
  return content.split('\n').filter(l=>l.trim()).map(line=>{
    const type = severityFromText(line);
    return { message:line, time:null, date:null, component:null, thread:null, type, typeName:TYPE_NAME[type], file:null, format:'plain', raw:line };
  });
}

// ── Format detection ──────────────────────────────────────────────────────────
function detectFormat(content) {
  if (content.includes('<![LOG[') && content.includes(']LOG]!>')) return 'cmtrace';
  if (content.includes('$$<')) return 'simple';
  const sample = content.split('\n').filter(l=>l.trim()).slice(0,10).join('\n');
  if (CBS_STRICT.test(sample)) return 'cbs';
  if (CBS_RELAX.test(sample)) return 'panther';
  // Check timestamped: need ≥2 lines matching
  let tsCount = 0;
  for (const p of TS_PATTERNS.slice(0,3)) {
    for (const line of sample.split('\n')) {
      if (p.re.test(line.trim())) tsCount++;
    }
  }
  if (tsCount >= 2) return 'timestamped';
  return 'plain';
}

function parseContent(content) {
  const fmt = detectFormat(content);
  switch (fmt) {
    case 'cmtrace':     return parseCMTrace(content);
    case 'simple':      return parseSimple(content);
    case 'cbs':         return parseCBS(content);
    case 'panther':     return parsePanther(content);
    case 'timestamped': return parseTimestamped(content);
    default:            return parsePlain(content);
  }
}

function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return parseContent(content);
}

function parseLine(line) {
  const entries = parseContent(line);
  return entries[0] || { message:line, time:null, date:null, component:null, thread:null, type:1, typeName:'Info', file:null, format:'plain', raw:line };
}

// ── Routes ────────────────────────────────────────────────────────────────────
const router = Router();

router.get('/api/read', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    res.json({ entries: parseFile(filePath), path: filePath });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    if (err.code === 'EACCES') return res.status(403).json({ error: 'Access denied' });
    throw err;
  }
});

router.post('/api/parse', (req, res) => {
  const content = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'text body required' });
  res.json({ entries: parseContent(content) });
});

module.exports = { parseFile, parseLine, parseContent, router };
