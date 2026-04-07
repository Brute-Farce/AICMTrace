'use strict';

// ── Intune Diagnostics Tab ─────────────────────────────────────────────────

var intuneEntries = [];
var intuneEvents  = [];

// Event type patterns (checked against message + component)
var INTUNE_PATTERNS = [
  {
    type: 'Win32App',
    startRe: /installing app|win32app.*policy|enforcement.*app|start.*install.*app/i,
    successRe: /successfully installed|install.*exit code.*\b0\b|installation succeeded|detected.*present/i,
    failRe: /failed.*install|install.*failed|installation failed|exit code.*[^0 ]/i,
  },
  {
    type: 'WinGet',
    startRe: /winget|wingetapp|windows package manager.*install/i,
    successRe: /winget.*success|winget.*completed|wingetapp.*installed/i,
    failRe: /winget.*fail|wingetapp.*failed/i,
  },
  {
    type: 'PowerShellScript',
    startRe: /script.*execut|executing.*script|running.*\.ps1|agentexecutor.*script/i,
    successRe: /script.*exit code.*\b0\b|script.*success|script.*completed.*result.*true/i,
    failRe: /script.*failed|script.*exit code.*[^0 ]|script.*exception/i,
  },
  {
    type: 'Remediation',
    startRe: /remediation|health.*script|detection script.*execut/i,
    successRe: /remediation.*success|compliant|remediated/i,
    failRe: /remediation.*fail|non.?compliant|detection.*fail/i,
  },
  {
    type: 'ESP',
    startRe: /enrollment status page|esp.*phase|esp.*start/i,
    successRe: /esp.*complete|esp.*success/i,
    failRe: /esp.*fail|esp.*timeout/i,
  },
  {
    type: 'SyncSession',
    startRe: /sync.*session.*start|device.*sync.*start|starting.*sync/i,
    successRe: /sync.*session.*end|sync.*success|sync.*completed/i,
    failRe: /sync.*failed|sync.*error/i,
  },
  {
    type: 'ContentDownload',
    startRe: /download(ing)? content|download(ing)? app|start.*download/i,
    successRe: /download.*completed|downloaded.*successfully/i,
    failRe: /download.*failed|download.*error/i,
  },
];

var GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
var SIZE_RE  = /(\d+(?:\.\d+)?)\s*(kb|mb|gb|bytes?)\b/i;
var SPEED_RE = /(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|kbps|mbps)/i;
var DO_RE    = /delivery optim\w+.*?(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%.*delivery optim/i;

function classifyEntry(entry) {
  var msg  = (entry.message  || '').toLowerCase();
  var comp = (entry.component || '').toLowerCase();
  var combined = comp + ' ' + msg;

  for (var i = 0; i < INTUNE_PATTERNS.length; i++) {
    var p = INTUNE_PATTERNS[i];
    var isStart   = p.startRe.test(combined);
    var isSuccess = p.successRe.test(combined);
    var isFail    = p.failRe.test(combined);

    if (isStart || isSuccess || isFail) {
      var status = 'Unknown';
      if (isSuccess)      status = 'Success';
      else if (isFail)    status = 'Failed';
      else if (isStart)   status = 'InProgress';

      var guid = null;
      var gm = GUID_RE.exec(entry.message || '');
      if (gm) guid = gm[0];

      return { type: p.type, status: status, guid: guid };
    }
  }
  return null;
}

function extractDownloadStats(entries) {
  var stats = [];
  entries.forEach(function(e) {
    var m = (e.message || '');
    var sizem = SIZE_RE.exec(m);
    var speedm = SPEED_RE.exec(m);
    var dom = DO_RE.exec(m);
    if (sizem || speedm || dom) {
      stats.push({
        ts: (e.date || '') + ' ' + (e.time || ''),
        size:  sizem  ? sizem[1]  + ' ' + sizem[2]  : null,
        speed: speedm ? speedm[1] + ' ' + speedm[2] : null,
        do_pct: dom   ? (dom[1] || dom[2]) + '%'    : null,
        msg: m.length > 120 ? m.slice(0, 120) + '...' : m,
      });
    }
  });
  return stats.slice(0, 30);
}

function buildTimeline(entries) {
  var events = [];
  entries.forEach(function(entry) {
    var cls = classifyEntry(entry);
    if (cls) {
      events.push({
        type:      cls.type,
        status:    cls.status,
        guid:      cls.guid,
        ts:        (entry.date || '') + ' ' + (entry.time || ''),
        detail:    entry.message || '',
        component: entry.component || '',
      });
    }
  });
  return events;
}

// ── Column resize ──────────────────────────────────────────────────────────
var INTUNE_COL_MIN = 50;
var intuneColWidths = (function() {
  try { return JSON.parse(localStorage.getItem('aicm-intune-cols')) || null; } catch(_) { return null; }
})() || [140, 90, 100];

function applyIntuneColTemplate() {
  var tpl = intuneColWidths.map(function(w) { return w + 'px'; }).join(' ') + ' 1fr';
  document.documentElement.style.setProperty('--intune-col-template', tpl);
}
applyIntuneColTemplate();

(function() {
  var dragging = false, colIdx = -1, startX = 0, startW = 0;
  var defaultWidths = [140, 90, 100];

  var timeline = document.getElementById('intune-timeline');

  timeline.addEventListener('mousedown', function(e) {
    var h = e.target.closest('.intune-col-rz');
    if (!h) return;
    e.preventDefault();
    dragging = true;
    colIdx = parseInt(h.dataset.col, 10);
    startX = e.clientX;
    startW = intuneColWidths[colIdx];
    h.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    intuneColWidths[colIdx] = Math.max(INTUNE_COL_MIN, startW + (e.clientX - startX));
    applyIntuneColTemplate();
  });

  document.addEventListener('mouseup', function(e) {
    if (!dragging) return;
    dragging = false;
    var active = timeline.querySelector('.intune-col-rz.active');
    if (active) active.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('aicm-intune-cols', JSON.stringify(intuneColWidths));
  });

  // Double-click handle to reset column to default
  timeline.addEventListener('dblclick', function(e) {
    var h = e.target.closest('.intune-col-rz');
    if (h) {
      var i = parseInt(h.dataset.col, 10);
      intuneColWidths[i] = defaultWidths[i];
      applyIntuneColTemplate();
      localStorage.setItem('aicm-intune-cols', JSON.stringify(intuneColWidths));
      return;
    }
    // Double-click on an event row → show modal
    var row = e.target.closest('.intune-event');
    if (row && !row.classList.contains('intune-event-header')) {
      var idx = parseInt(row.dataset.evIdx, 10);
      if (!isNaN(idx) && intuneEvents[idx]) showIntuneModal(intuneEvents[idx]);
    }
  });
})();

function showIntuneModal(ev) {
  var statusCls = ev.status === 'Failed' ? 'val-error' : ev.status === 'Success' ? 'val-info' : '';
  showFieldsModal('Intune Event Detail', [
    { label: 'Timestamp',  value: ev.ts },
    { label: 'Type',       value: ev.type },
    { label: 'Status',     value: ev.status, cls: statusCls },
    { label: 'Component',  value: ev.component },
    { label: 'GUID',       value: ev.guid || '' },
    { label: 'Detail',     value: ev.detail },
  ]);
}

function renderIntune(entries) {
  intuneEntries = entries;
  intuneEvents  = buildTimeline(entries);
  var dlStats   = extractDownloadStats(entries);

  // Summary
  var byType = {};
  var ok = 0, fail = 0;
  intuneEvents.forEach(function(ev) {
    byType[ev.type] = (byType[ev.type] || 0) + 1;
    if (ev.status === 'Success') ok++;
    if (ev.status === 'Failed')  fail++;
  });

  var summaryBox = document.getElementById('intune-summary-box');
  var summaryContent = document.getElementById('intune-summary-content');
  if (intuneEvents.length) {
    summaryBox.style.display = 'block';
    var html = '<div class="intune-stat"><span>Total Events</span><span class="val">' + intuneEvents.length + '</span></div>';
    html += '<div class="intune-stat"><span>Successes</span><span class="val ok">' + ok + '</span></div>';
    html += '<div class="intune-stat"><span>Failures</span><span class="val' + (fail ? ' err' : '') + '">' + fail + '</span></div>';
    Object.keys(byType).forEach(function(t) {
      html += '<div class="intune-stat"><span>' + t + '</span><span class="val">' + byType[t] + '</span></div>';
    });
    summaryContent.innerHTML = html;
  }

  var dlBox = document.getElementById('intune-dl-box');
  var dlContent = document.getElementById('intune-dl-content');
  if (dlStats.length) {
    dlBox.style.display = 'block';
    var dlHtml = '';
    dlStats.slice(0, 10).forEach(function(s) {
      dlHtml += '<div class="intune-stat" style="flex-direction:column;align-items:flex-start;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:4px;">';
      if (s.size)   dlHtml += '<div>&#128190; Size: <span class="val">' + eh(s.size) + '</span></div>';
      if (s.speed)  dlHtml += '<div>&#9889; Speed: <span class="val">' + eh(s.speed) + '</span></div>';
      if (s.do_pct) dlHtml += '<div>&#128260; DO: <span class="val">' + eh(s.do_pct) + '</span></div>';
      dlHtml += '<div style="color:var(--text3);font-size:11px;margin-top:2px;">' + eh(s.msg) + '</div>';
      dlHtml += '</div>';
    });
    dlContent.innerHTML = dlHtml;
  }

  // Timeline
  var timeline = document.getElementById('intune-timeline');
  var empty = document.getElementById('intune-empty');
  empty.style.display = 'none';

  if (!intuneEvents.length) {
    empty.style.display = 'block';
    empty.innerHTML = '<div style="font-size:36px;margin-bottom:8px;">&#128269;</div>' +
      '<div>No recognizable Intune events found in this log.</div>' +
      '<div style="margin-top:6px;color:var(--text3);font-size:12px;">Make sure this is an IntuneManagementExtension.log or AppWorkload.log file.</div>';
    return;
  }

  // Header with resize handles on first 3 columns
  var tHtml = '<div class="intune-event-header">' +
    '<span>Timestamp<i class="col-rz intune-col-rz" data-col="0"></i></span>' +
    '<span>Type<i class="col-rz intune-col-rz" data-col="1"></i></span>' +
    '<span>Status<i class="col-rz intune-col-rz" data-col="2"></i></span>' +
    '<span>Detail</span>' +
    '</div>';

  intuneEvents.forEach(function(ev, idx) {
    var statusClass = ev.status === 'Success' ? 'ev-status-ok' :
                      ev.status === 'Failed'  ? 'ev-status-fail' :
                      ev.status === 'InProgress' ? 'ev-status-prog' : 'ev-status-unk';
    var rowClass = ev.status === 'Success' ? 'ev-success' :
                   ev.status === 'Failed'  ? 'ev-failed'  :
                   ev.status === 'InProgress' ? 'ev-inprogress' : 'ev-unknown';

    tHtml += '<div class="intune-event ' + rowClass + '" data-ev-idx="' + idx + '" title="Double-click for details">' +
      '<span class="ev-ts">'     + eh(ev.ts)     + '</span>' +
      '<span class="ev-type">'   + eh(ev.type)   + '</span>' +
      '<span class="' + statusClass + '">' + eh(ev.status) + '</span>' +
      '<span class="ev-detail">' + eh(ev.detail) + '</span>' +
      '</div>';
  });

  timeline.innerHTML = tHtml;
}

// Wire up buttons
document.getElementById('intune-open-btn').onclick = function() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.log,.txt,.lo_';
  input.onchange = function() {
    var file = input.files[0];
    if (!file) return;
    var label = document.getElementById('intune-file-label');
    label.textContent = file.name;
    var reader = new FileReader();
    reader.onload = function(ev) {
      fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: ev.target.result
      })
      .then(function(r) { return r.json(); })
      .then(function(data) { renderIntune(data.entries || []); })
      .catch(function(err) {
        document.getElementById('intune-timeline').innerHTML =
          '<div class="intune-empty" style="color:var(--row-err-fg);">Error: ' + eh(err.message) + '</div>';
      });
    };
    reader.readAsText(file);
  };
  input.click();
};

document.getElementById('intune-clear-btn').onclick = function() {
  intuneEntries = []; intuneEvents = [];
  document.getElementById('intune-summary-box').style.display = 'none';
  document.getElementById('intune-dl-box').style.display = 'none';
  document.getElementById('intune-timeline').innerHTML =
    '<div class="intune-empty" id="intune-empty">Load an IME log to see the diagnostic timeline.</div>';
  document.getElementById('intune-file-label').textContent = 'No file loaded';
};

// Drag-and-drop on the intune tab
var intuneTimeline = document.getElementById('intune-timeline');
intuneTimeline.ondragover = function(e) { e.preventDefault(); };
intuneTimeline.ondrop = function(e) {
  e.preventDefault();
  var file = e.dataTransfer.files[0];
  if (!file) return;
  document.getElementById('intune-file-label').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function(ev) {
    fetch('/api/parse', { method:'POST', headers:{'Content-Type':'text/plain'}, body:ev.target.result })
    .then(function(r) { return r.json(); })
    .then(function(data) { renderIntune(data.entries || []); });
  };
  reader.readAsText(file);
};

function eh(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
