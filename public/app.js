'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
var ROW_HEIGHT = 22;
var BUFFER = 80;

// Source file color palette (cycles for each new file added)
var FILE_COLORS = [
  '#4f9cf9', '#4ec9b0', '#dcdcaa', '#c586c0',
  '#ce9178', '#9cdcfe', '#f44747', '#d7ba7d',
  '#b5cea8', '#f48771', '#a9dc76', '#78dce8'
];

// ── State ──────────────────────────────────────────────────────────────────
var socket = io();

// Multi-file tracking
var openedFiles  = {};     // { key: { name, path, entries[], checked, color, isChannel } }
var watchedKey   = null;   // which source is currently being tailed
var nextColorIdx = 0;

// Flattened/merged view entries (rebuilt from openedFiles)
var allEntries      = [];
var filteredEntries = [];
var autoScroll      = true;
var tailPaused      = false;
var severityFilter  = 0;
var filterText      = '';
var filterIsRegex   = false;
var selectedIdx     = -1;
var vsStart         = -1;
var vsEnd           = -1;

// Find state
var findText    = '';
var findIsRegex = false;
var findResults = [];
var findIdx     = -1;

// Active main tab
var activeTab = 'viewer';

// ── DOM refs ───────────────────────────────────────────────────────────────
var $ = function(id) { return document.getElementById(id); };

var fileList        = $('file-list');
var sidebarPath     = $('sidebar-path');
var openFilesList   = $('open-files-list');
var openFilesEmpty  = $('open-files-empty');
var logScrollWrap   = $('log-scroll-wrap');
var logScrollInner  = $('log-scroll-inner');
var logHeader       = $('log-header');
var emptyState      = $('empty-state');
var detailPanel     = $('detail-panel');
var filterInput     = $('filter-input');
var autoscrollBtn   = $('autoscroll-btn');
var clearBtn        = $('clear-btn');
var pauseBtn        = $('pause-btn');
var exportBtn       = $('export-btn');
var statusEntries   = $('status-entries');
var statusFiltered  = $('status-filtered');
var statusWatching  = $('status-watching');
var statusErrors    = $('status-errors');
var findBar         = $('find-bar');
var findInput       = $('find-input');
var themeSelect     = $('theme-select');
var fontSizeDisp    = $('font-size-display');

// ── Column resize ──────────────────────────────────────────────────────────
var COL_MIN = 40;
var colWidths = (function() {
  try { return JSON.parse(localStorage.getItem('aicm-cols')) || null; } catch (_) { return null; }
})() || [90, 90, 140, 70, 65, 65];

function applyColTemplate() {
  // First column is the 8px source-color stripe (not user-resizable)
  var tpl = '8px ' + colWidths.map(function(w) { return w + 'px'; }).join(' ') + ' 1fr';
  document.documentElement.style.setProperty('--col-template', tpl);
}
applyColTemplate();

(function() {
  var dragging = false, colIdx = -1, startX = 0, startW = 0, activeHandle = null;

  $('log-header').addEventListener('mousedown', function(e) {
    var h = e.target.closest('.col-rz');
    if (!h) return;
    e.preventDefault();
    dragging = true;
    colIdx = parseInt(h.dataset.col, 10);
    startX = e.clientX;
    startW = colWidths[colIdx];
    activeHandle = h;
    h.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    colWidths[colIdx] = Math.max(COL_MIN, startW + (e.clientX - startX));
    applyColTemplate();
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    if (activeHandle) { activeHandle.classList.remove('active'); activeHandle = null; }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('aicm-cols', JSON.stringify(colWidths));
    vsStart = -1; vsEnd = -1; renderVS();
  });

  // Double-click handle to reset column width
  var defaultWidths = [90, 90, 140, 70, 65, 65];
  $('log-header').addEventListener('dblclick', function(e) {
    var h = e.target.closest('.col-rz');
    if (!h) return;
    var i = parseInt(h.dataset.col, 10);
    colWidths[i] = defaultWidths[i];
    applyColTemplate();
    localStorage.setItem('aicm-cols', JSON.stringify(colWidths));
    vsStart = -1; vsEnd = -1; renderVS();
  });
})();

// ── Font size ──────────────────────────────────────────────────────────────
var fontSize = parseInt(localStorage.getItem('aicm-font') || '13', 10);
applyFont(fontSize);

$('font-smaller').onclick = function() { applyFont(Math.max(10, --fontSize)); };
$('font-larger').onclick  = function() { applyFont(Math.min(20, ++fontSize)); };

function applyFont(n) {
  fontSize = n;
  document.documentElement.style.setProperty('--font-size', n + 'px');
  localStorage.setItem('aicm-font', n);
  if (fontSizeDisp) fontSizeDisp.textContent = n + 'px';
}

// ── Theme ──────────────────────────────────────────────────────────────────
var savedTheme = localStorage.getItem('aicm-theme') || 'dark';
document.body.dataset.theme = savedTheme;
if (themeSelect) themeSelect.value = savedTheme;

if (themeSelect) {
  themeSelect.onchange = function() {
    document.body.dataset.theme = themeSelect.value;
    localStorage.setItem('aicm-theme', themeSelect.value);
  };
}

// ── Tab management ─────────────────────────────────────────────────────────
document.querySelectorAll('.main-tab').forEach(function(btn) {
  btn.onclick = function() { switchTab(btn.dataset.tab); };
});

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.main-tab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('#main .tab-content').forEach(function(c) {
    c.classList.toggle('active', c.dataset.tab === tab);
  });
  var sections = ['viewer', 'eventviewer', 'intune', 'dsreg'];
  sections.forEach(function(s) {
    var el = $('toolbar-' + s);
    if (el) el.style.display = (s === tab) ? 'flex' : 'none';
  });
}

// Activate the viewer toolbar on load
switchTab('viewer');

// ── Resizers ───────────────────────────────────────────────────────────────
var activeResizer = null;
document.addEventListener('mousemove', function(e) {
  if (activeResizer) activeResizer.move(e);
});
document.addEventListener('mouseup', function() {
  if (activeResizer) { activeResizer.stop(); activeResizer = null; }
});

function makeColResizer(handle, getTarget, min, max) {
  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var target = getTarget();
    var startX = e.clientX;
    var startW = target.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cssText += 'cursor:col-resize!important;user-select:none!important';
    activeResizer = {
      move: function(ev) {
        target.style.width = Math.max(min, Math.min(max, startW + ev.clientX - startX)) + 'px';
      },
      stop: function() {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  });
}

makeColResizer($('resizer'),  function() { return $('sidebar');      }, 140, 500);
makeColResizer($('resizer2'), function() { return $('files-panel');  }, 160, 460);

// ── File Browser ───────────────────────────────────────────────────────────
function fetchBrowse(dirPath) {
  var url = '/api/browse' + (dirPath ? '?path=' + encodeURIComponent(dirPath) : '');
  return fetch(url).then(function(r) { return r.json(); });
}

function renderBrowser(data) {
  sidebarPath.textContent = data.current || 'Drives';
  sidebarPath.title = data.current || '';
  var html = '';
  if (data.parent) {
    html += '<li class="parent-dir" data-path="' + ea(data.parent) + '"><span class="icon">&#8593;</span><span class="name">..</span></li>';
  }
  (data.entries || []).forEach(function(e) {
    if (data.isRoot) {
      html += '<li class="dir" data-path="' + ea(e.name) + '"><span class="icon">&#128250;</span><span class="name">' + eh(e.name) + '</span></li>';
    } else if (e.isDir) {
      html += '<li class="dir" data-path="' + ea(data.current + '\\' + e.name) + '"><span class="icon">&#128193;</span><span class="name">' + eh(e.name) + '</span></li>';
    } else {
      html += '<li class="log-file" data-path="' + ea(data.current + '\\' + e.name) + '"><span class="icon">&#128196;</span><span class="name">' + eh(e.name) + '</span></li>';
    }
  });
  if (!html) html = '<li style="color:var(--text3);padding:8px 12px;">No log files found</li>';
  fileList.innerHTML = html;

  fileList.querySelectorAll('li[data-path]').forEach(function(li) {
    li.onclick = function() {
      var p = li.getAttribute('data-path');
      if (li.classList.contains('dir') || li.classList.contains('parent-dir')) {
        fetchBrowse(p).then(renderBrowser).catch(function(err) {
          fileList.innerHTML = '<li style="color:var(--row-err-fg);padding:8px;">' + eh(err.message) + '</li>';
        });
      } else {
        fileList.querySelectorAll('li').forEach(function(x) { x.classList.remove('selected'); });
        li.classList.add('selected');
        openLogFile(p);
      }
    };
  });
}

// ── Open file button ───────────────────────────────────────────────────────
$('open-file-btn').onclick = function() {
  fetchBrowse(null).then(renderBrowser);
};

// ── Multi-file: Open log file ──────────────────────────────────────────────
function openLogFile(filePath) {
  var key = filePath;

  // If already open, just ensure it's checked and visible
  if (openedFiles[key]) {
    openedFiles[key].checked = true;
    renderOpenFilesList();
    rebuildAllEntries();
    return;
  }

  var name  = filePath.split(/[\\/]/).pop();
  var color = FILE_COLORS[nextColorIdx % FILE_COLORS.length];
  nextColorIdx++;

  openedFiles[key] = {
    name: name, path: filePath,
    entries: [], checked: true,
    color: color, isChannel: false, loading: true
  };
  renderOpenFilesList();
  showLogArea();

  var isEvtx = name.toLowerCase().endsWith('.evtx');
  var apiUrl = isEvtx
    ? '/api/evtx?path=' + encodeURIComponent(filePath)
    : '/api/read?path='  + encodeURIComponent(filePath);

  // Stop tailing previous file
  if (watchedKey && !isEvtx) socket.emit('unwatch');
  if (!isEvtx) watchedKey = key;
  tailPaused = false;
  if (pauseBtn) { pauseBtn.textContent = 'Pause'; pauseBtn.classList.remove('active'); }

  fetch(apiUrl)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) throw new Error(data.error);
      var raw = data.entries || [];
      var entries = raw.map(function(e) {
        return Object.assign({}, e, { _srcKey: key, _srcColor: color });
      });
      openedFiles[key].entries = entries;
      openedFiles[key].loading = false;
      renderOpenFilesList();
      rebuildAllEntries();
      updateStatus();
      if (!isEvtx) {
        socket.emit('watch', { path: filePath });
        openedFiles[key].watching = true;
        statusWatching.textContent = '\uD83D\uDD12 Watching: ' + name;
      } else {
        openedFiles[key].snapshot = true;
        statusWatching.textContent = '\uD83D\uDCC4 ' + name + ' (snapshot)';
      }
      renderOpenFilesList();
    })
    .catch(function(err) {
      if (openedFiles[key]) openedFiles[key].loading = false;
      renderOpenFilesList();
      logScrollInner.style.height = '0px';
      logScrollInner.innerHTML = '<div style="color:var(--row-err-fg);padding:10px;">&#10060; ' + eh(err.message) + '</div>';
    });
}

// ── Multi-file: Open live Event Log channel ────────────────────────────────
function openChannel(channelName) {
  var key = 'channel:' + channelName;

  if (openedFiles[key]) {
    openedFiles[key].checked = true;
    renderOpenFilesList();
    rebuildAllEntries();
    return;
  }

  var name  = channelName.split('/').pop();
  var color = FILE_COLORS[nextColorIdx % FILE_COLORS.length];
  nextColorIdx++;

  openedFiles[key] = {
    name: name, path: channelName,
    entries: [], checked: true,
    color: color, isChannel: true, loading: true
  };
  renderOpenFilesList();
  showLogArea();

  if (watchedKey) socket.emit('unwatch');
  watchedKey = key;
  tailPaused = false;
  if (pauseBtn) { pauseBtn.textContent = 'Pause'; pauseBtn.classList.remove('active'); }

  document.title = name + ' - AICMTrace';

  fetch('/api/evtx?channel=' + encodeURIComponent(channelName))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) throw new Error(data.error);
      var raw = data.entries || [];
      var entries = raw.map(function(e) {
        return Object.assign({}, e, { _srcKey: key, _srcColor: color });
      });
      openedFiles[key].entries = entries;
      openedFiles[key].loading = false;
      openedFiles[key].watching = true;
      renderOpenFilesList();
      rebuildAllEntries();
      updateStatus();

      var since = new Date().toISOString();
      for (var i = entries.length - 1; i >= 0; i--) {
        if (entries[i].isoTime) { since = entries[i].isoTime; break; }
      }
      socket.emit('watch:channel', { channel: channelName, since: since });
      statusWatching.textContent = '\uD83D\uDD12 Live: ' + channelName;
      renderOpenFilesList();
    })
    .catch(function(err) {
      if (openedFiles[key]) openedFiles[key].loading = false;
      renderOpenFilesList();
      logScrollInner.style.height = '0px';
      logScrollInner.innerHTML = '<div style="color:var(--row-err-fg);padding:10px;">&#10060; ' + eh(err.message) + '</div>';
    });
}

// ── Multi-file: Rebuild merged entries ─────────────────────────────────────
function rebuildAllEntries() {
  var merged = [];
  Object.keys(openedFiles).forEach(function(key) {
    var f = openedFiles[key];
    if (!f.checked) return;
    merged = merged.concat(f.entries);
  });
  merged.sort(function(a, b) {
    var ta = logTimeMs(a), tb = logTimeMs(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return ta - tb;
  });
  allEntries = merged;
  applyFilter();
}

function logTimeMs(e) {
  try {
    var d = (e.date || '').replace(/^(\d+)-(\d+)-(\d{4})$/, '$3-$1-$2');
    var t = (e.time || '').replace(/[+-]\d+$/, '');
    if (!d && !t) return null;
    var dt = new Date(d + 'T' + t);
    return isNaN(dt.getTime()) ? null : dt.getTime();
  } catch (_) { return null; }
}

// ── Multi-file: Render open files list ─────────────────────────────────────
function renderOpenFilesList() {
  var keys = Object.keys(openedFiles);
  if (!keys.length) {
    openFilesEmpty.style.display = 'flex';
    openFilesList.innerHTML = '';
    return;
  }
  openFilesEmpty.style.display = 'none';

  var html = '';
  keys.forEach(function(key) {
    var f = openedFiles[key];
    var badge = '';
    if (f.loading) {
      badge = '<span class="open-file-badge">loading</span>';
    } else if (f.watching) {
      badge = '<span class="open-file-badge watching">live</span>';
    } else if (f.snapshot) {
      badge = '<span class="open-file-badge snapshot">snapshot</span>';
    }
    var pathShort = truncatePath(f.path);
    html +=
      '<li class="open-file-item" data-key="' + ea(key) + '">' +
        '<span class="open-file-dot" style="background:' + f.color + ';box-shadow:0 0 5px ' + f.color + '"></span>' +
        '<div class="open-file-item-inner">' +
          '<label class="open-file-check">' +
            '<input type="checkbox" ' + (f.checked ? 'checked' : '') + ' data-key="' + ea(key) + '">' +
            '<span class="open-file-name" title="' + ea(f.path) + '">' + eh(f.name) + '</span>' +
          '</label>' +
          '<span class="open-file-path-line" title="' + ea(f.path) + '">' + eh(pathShort) + '</span>' +
        '</div>' +
        badge +
        '<button class="open-file-remove" data-key="' + ea(key) + '" title="Remove">&#10005;</button>' +
      '</li>';
  });
  openFilesList.innerHTML = html;

  openFilesList.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
    cb.onchange = function() {
      var k = cb.getAttribute('data-key');
      if (openedFiles[k]) { openedFiles[k].checked = cb.checked; }
      rebuildAllEntries();
      updateStatus();
      if (!allEntries.length) {
        emptyState.style.display = '';
        logScrollWrap.style.display = 'none';
        logHeader.style.display = 'none';
      }
    };
  });

  openFilesList.querySelectorAll('.open-file-remove').forEach(function(btn) {
    btn.onclick = function() {
      var k = btn.getAttribute('data-key');
      if (!openedFiles[k]) return;
      if (watchedKey === k) { socket.emit('unwatch'); watchedKey = null; }
      delete openedFiles[k];
      renderOpenFilesList();
      rebuildAllEntries();
      updateStatus();
      if (!Object.keys(openedFiles).length) {
        emptyState.style.display = '';
        logScrollWrap.style.display = 'none';
        logHeader.style.display = 'none';
        statusWatching.textContent = '';
      }
    };
  });
}

// ── Clear all open files ───────────────────────────────────────────────────
$('files-panel-clear').onclick = function() {
  socket.emit('unwatch');
  watchedKey = null;
  openedFiles = {};
  allEntries = [];
  filteredEntries = [];
  vsStart = -1; vsEnd = -1;
  selectedIdx = -1;
  clearFind();
  detailPanel.classList.remove('visible');
  renderOpenFilesList();
  emptyState.style.display = '';
  logScrollWrap.style.display = 'none';
  logHeader.style.display = 'none';
  updateStatus();
  statusWatching.textContent = '';
};

function truncatePath(p) {
  if (!p) return '';
  if (p.length <= 36) return p;
  var parts = p.split(/[\\/]/);
  if (parts.length <= 2) return p.slice(0, 34) + '\u2026';
  return '\u2026\\' + parts.slice(-2).join('\\');
}

// ── Open from content (drag-and-drop) ─────────────────────────────────────
function openFromContent(content, fileName) {
  var key = 'drop:' + fileName + ':' + Date.now();
  var color = FILE_COLORS[nextColorIdx % FILE_COLORS.length];
  nextColorIdx++;

  openedFiles[key] = {
    name: fileName, path: fileName + ' (dropped)',
    entries: [], checked: true,
    color: color, isChannel: false, loading: true
  };
  renderOpenFilesList();
  showLogArea();

  if (watchedKey) socket.emit('unwatch');
  watchedKey = null; // dropped files can't be tailed
  tailPaused = false;

  fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: content
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) throw new Error(data.error);
    var raw = data.entries || [];
    openedFiles[key].entries = raw.map(function(e) {
      return Object.assign({}, e, { _srcKey: key, _srcColor: color });
    });
    openedFiles[key].loading = false;
    openedFiles[key].snapshot = true;
    renderOpenFilesList();
    rebuildAllEntries();
    updateStatus();
  })
  .catch(function(err) {
    if (openedFiles[key]) openedFiles[key].loading = false;
    renderOpenFilesList();
    logScrollInner.innerHTML = '<div style="color:var(--row-err-fg);padding:10px;">Error: ' + eh(err.message) + '</div>';
  });
}

// ── Show log area ──────────────────────────────────────────────────────────
function showLogArea() {
  emptyState.style.display = 'none';
  logScrollWrap.style.display = 'block';
  logHeader.style.display = 'grid';
}

// ── Drag-and-drop ──────────────────────────────────────────────────────────
var viewerEl = $('viewer');
viewerEl.ondragover  = function(e) { e.preventDefault(); viewerEl.classList.add('drag-over'); };
viewerEl.ondragleave = function(e) { if (!viewerEl.contains(e.relatedTarget)) viewerEl.classList.remove('drag-over'); };
viewerEl.ondrop      = function(e) {
  e.preventDefault();
  viewerEl.classList.remove('drag-over');
  var file = e.dataTransfer.files[0];
  if (!file) return;
  if (file.name.toLowerCase().endsWith('.evtx')) {
    showLogArea();
    logScrollInner.innerHTML = '<div style="color:var(--row-warn-fg);padding:16px;">&#128203; .evtx files must be opened via the file browser.</div>';
    return;
  }
  var reader = new FileReader();
  reader.onload = function(ev) { openFromContent(ev.target.result, file.name); };
  reader.readAsText(file);
};

// ── Socket / tail ──────────────────────────────────────────────────────────
socket.on('log:lines', function(data) {
  if (tailPaused || activeTab !== 'viewer') return;
  if (!watchedKey || !openedFiles[watchedKey]) return;
  var color = openedFiles[watchedKey].color;
  var newE = (data.entries || []).map(function(e) {
    return Object.assign({}, e, { _srcKey: watchedKey, _srcColor: color });
  });
  newE.forEach(function(e) { openedFiles[watchedKey].entries.push(e); });
  // Append to end of allEntries (new tail lines are always latest)
  newE.forEach(function(e) { allEntries.push(e); });
  var newF = newE.filter(matchesFilter);
  newF.forEach(function(e) { filteredEntries.push(e); });
  vsStart = -1; vsEnd = -1;
  renderVS();
  updateStatus();
  if (autoScroll) logScrollWrap.scrollTop = logScrollWrap.scrollHeight;
});

// ── Pause / Resume ─────────────────────────────────────────────────────────
if (pauseBtn) {
  pauseBtn.onclick = function() {
    tailPaused = !tailPaused;
    pauseBtn.textContent = tailPaused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('active', tailPaused);
  };
}

// ── Auto-scroll ────────────────────────────────────────────────────────────
autoscrollBtn.onclick = function() {
  autoScroll = !autoScroll;
  autoscrollBtn.classList.toggle('active', autoScroll);
  if (autoScroll) logScrollWrap.scrollTop = logScrollWrap.scrollHeight;
};

// ── Clear ──────────────────────────────────────────────────────────────────
clearBtn.onclick = function() {
  // Clear entries from all open files but keep the file list intact
  Object.keys(openedFiles).forEach(function(k) { openedFiles[k].entries = []; });
  allEntries = []; filteredEntries = [];
  vsStart = -1; vsEnd = -1;
  logScrollInner.style.height = '0px';
  logScrollInner.innerHTML = '';
  detailPanel.classList.remove('visible');
  clearFind(); updateStatus();
};

// ── Filter ─────────────────────────────────────────────────────────────────
var filterTimer;
filterInput.oninput = function() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(function() {
    filterText = filterInput.value.trim();
    applyFilter(); updateStatus();
  }, 150);
};

$('filter-regex-cb').onchange = function() {
  filterIsRegex = $('filter-regex-cb').checked;
  filterText = filterInput.value.trim();
  applyFilter(); updateStatus();
};

document.querySelectorAll('.sev-btn').forEach(function(btn) {
  btn.onclick = function() {
    severityFilter = parseInt(btn.dataset.sev, 10) || 0;
    document.querySelectorAll('.sev-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.sev === btn.dataset.sev);
    });
    applyFilter(); updateStatus();
  };
});

function matchesFilter(e) {
  if (severityFilter > 0 && e.type !== severityFilter) return false;
  if (!filterText) return true;
  if (filterIsRegex) {
    try {
      var re = new RegExp(filterText, 'i');
      return re.test(e.message || '') || re.test(e.component || '') || re.test(e.file || '');
    } catch (_) { return false; }
  }
  var low = filterText.toLowerCase();
  return (e.message   && e.message.toLowerCase().indexOf(low)   !== -1) ||
         (e.component && e.component.toLowerCase().indexOf(low) !== -1) ||
         (e.file      && e.file.toLowerCase().indexOf(low)      !== -1);
}

function applyFilter() {
  filteredEntries = allEntries.filter(matchesFilter);
  vsStart = -1; vsEnd = -1;
  renderVS();
  if (autoScroll) logScrollWrap.scrollTop = logScrollWrap.scrollHeight;
}

// ── Virtual scroll ─────────────────────────────────────────────────────────
logScrollWrap.onscroll = renderVS;

function renderVS() {
  var total = filteredEntries.length;
  if (!total) {
    logScrollInner.style.height = '0px';
    logScrollInner.innerHTML = '';
    return;
  }
  logScrollInner.style.height = (total * ROW_HEIGHT) + 'px';

  var scrollTop = logScrollWrap.scrollTop;
  var viewH = logScrollWrap.clientHeight || 400;
  var visStart = Math.floor(scrollTop / ROW_HEIGHT);
  var visEnd   = Math.ceil((scrollTop + viewH) / ROW_HEIGHT);
  var start = Math.max(0, visStart - BUFFER);
  var end   = Math.min(total - 1, visEnd + BUFFER);

  if (start === vsStart && end === vsEnd) return;
  vsStart = start; vsEnd = end;

  var frag = document.createDocumentFragment();
  for (var i = start; i <= end; i++) {
    frag.appendChild(buildRow(filteredEntries[i], i));
  }
  logScrollInner.innerHTML = '';
  logScrollInner.appendChild(frag);
}

function buildRow(entry, idx) {
  var div = document.createElement('div');
  div.className = 'log-row type-' + (entry.type || 1);
  div.style.top = (idx * ROW_HEIGHT) + 'px';
  div.dataset.idx = idx;
  if (idx === selectedIdx) div.classList.add('selected');
  if (findResults.indexOf(idx) !== -1) div.classList.add('find-match');
  if (findIdx >= 0 && idx === findResults[findIdx]) div.classList.add('find-current');

  var delta = '';
  if (idx > 0) delta = calcDelta(filteredEntries[idx - 1], entry);

  var srcColor = entry._srcColor || 'transparent';

  div.innerHTML =
    '<span class="col-src" style="background:' + srcColor + ';opacity:0.9"></span>' +
    '<span class="col-time">'    + eh(entry.time      || '') + '</span>' +
    '<span class="col-date">'    + eh(entry.date      || '') + '</span>' +
    '<span class="col-comp">'    + eh(entry.component || '') + '</span>' +
    '<span class="col-thread">'  + eh(entry.thread    || '') + '</span>' +
    '<span class="col-delta">'   + eh(delta)                + '</span>' +
    '<span class="col-type">'    + eh(entry.typeName  || 'Info') + '</span>' +
    '<span class="col-message">' + eh(entry.message   || '') + '</span>';

  div.onclick = function() {
    selectedIdx = idx;
    document.querySelectorAll('.log-row.selected').forEach(function(r) { r.classList.remove('selected'); });
    div.classList.add('selected');
    showDetail(entry);
  };
  div.ondblclick = function() { showModal(entry); };

  return div;
}

function calcDelta(prev, curr) {
  try {
    var a = logTimeMs(prev), b = logTimeMs(curr);
    if (!a || !b) return '';
    var ms = b - a;
    if (ms < 0) return '';
    if (ms < 1000) return '+' + ms + 'ms';
    if (ms < 60000) return '+' + (ms / 1000).toFixed(1) + 's';
    return '+' + Math.floor(ms / 60000) + 'm' + Math.floor((ms % 60000) / 1000) + 's';
  } catch (_) { return ''; }
}

// ── Detail panel ───────────────────────────────────────────────────────────
function showDetail(entry) {
  var txt = '<strong>Raw:</strong> ' + eh(entry.raw || entry.message || '');
  var codes = findErrorCodesInText(entry.message || '');
  if (codes.length) {
    txt += '\n\n<strong>Error Codes:</strong>\n';
    codes.forEach(function(c) {
      txt += '  ' + eh(c.code) + '  \u2192  ' + eh(c.description) + '\n';
    });
  }
  detailPanel.innerHTML = txt;
  detailPanel.classList.add('visible');
}

// ── Row detail modal ───────────────────────────────────────────────────────
var rowModal  = $('row-modal');
var modalBody = $('modal-body');

function showFieldsModal(title, fields) {
  var titleEl = $('modal-title-text');
  if (titleEl) titleEl.textContent = title;
  var html = '';
  fields.forEach(function(f) {
    if (!f.value) return;
    html += '<div>' +
      '<div class="modal-field-label">'  + eh(f.label) + '</div>' +
      '<div class="modal-field-value ' + (f.cls || '') + '">' + eh(f.value) + '</div>' +
      '</div>';
  });
  modalBody.innerHTML = html;
  rowModal.classList.remove('hidden');
  modalBody.scrollTop = 0;
}

function showModal(entry) {
  var typeClass = entry.type === 3 ? 'val-error' : entry.type === 2 ? 'val-warning' : 'val-info';
  var isEvtx = entry.format === 'evtx';
  var title   = isEvtx ? 'Event Log Entry' : 'Log Entry Detail';
  var fields  = isEvtx ? [
    { label: 'Level',     value: entry.typeName  || 'Information', cls: typeClass },
    { label: 'Date',      value: entry.date       || '' },
    { label: 'Time',      value: entry.time       || '' },
    { label: 'Event ID',  value: entry.eventId    || '' },
    { label: 'Channel',   value: entry.channel    || '' },
    { label: 'Source',    value: entry.component  || '' },
    { label: 'Computer',  value: entry.computer   || '' },
    { label: 'User',      value: entry.user       || '' },
    { label: 'Keywords',  value: entry.keywords   || '' },
    { label: 'Task',      value: entry.thread     || '' },
    { label: 'Message',   value: entry.message    || '' },
    { label: 'Raw',       value: entry.raw        || '' },
  ] : [
    { label: 'Type',      value: entry.typeName   || 'Info', cls: typeClass },
    { label: 'Time',      value: entry.time       || '' },
    { label: 'Date',      value: entry.date       || '' },
    { label: 'Component', value: entry.component  || '' },
    { label: 'Thread',    value: entry.thread     || '' },
    { label: 'File',      value: entry.file       || '' },
    { label: 'Format',    value: entry.format     || '' },
    { label: 'Message',   value: entry.message    || '' },
    { label: 'Raw',       value: entry.raw        || '' },
  ];
  showFieldsModal(title, fields);

  var codes = findErrorCodesInText(entry.message || '');
  if (codes.length) {
    var ec = '<div class="modal-error-codes"><div class="modal-error-codes-title">&#128270; Error Codes Found</div>';
    codes.forEach(function(c) {
      ec += '<div class="modal-error-code-row">' +
        '<span class="modal-ec-code">' + eh(c.code) + '</span>' +
        '<span class="modal-ec-desc">' + eh(c.description) + '</span>' +
        '</div>';
    });
    ec += '</div>';
    modalBody.insertAdjacentHTML('beforeend', ec);
  }
}

function closeModal() { rowModal.classList.add('hidden'); }

$('modal-close').onclick = closeModal;
rowModal.addEventListener('click', function(e) { if (e.target === rowModal) closeModal(); });
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && !rowModal.classList.contains('hidden')) closeModal();
});

// ── Find bar (Ctrl+F / F3) ─────────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    if (activeTab !== 'viewer') return;
    findBar.classList.toggle('hidden');
    if (!findBar.classList.contains('hidden')) findInput.focus();
  }
  if (e.key === 'F3') {
    e.preventDefault();
    if (e.shiftKey) prevFind(); else nextFind();
  }
  if (e.key === 'Escape' && !findBar.classList.contains('hidden')) {
    findBar.classList.add('hidden'); clearFind();
  }
});

var findTimer;
findInput.oninput = function() { clearTimeout(findTimer); findTimer = setTimeout(runFind, 150); };
$('find-regex-cb').onchange = function() { findIsRegex = $('find-regex-cb').checked; runFind(); };
$('find-prev').onclick  = prevFind;
$('find-next').onclick  = nextFind;
$('find-close').onclick = function() { findBar.classList.add('hidden'); clearFind(); };

function runFind() {
  findText = findInput.value.trim();
  findResults = []; findIdx = -1;
  if (!findText) { $('find-count').textContent = ''; renderVS(); return; }
  var matcher = buildMatcher(findText, findIsRegex);
  if (!matcher) return;
  filteredEntries.forEach(function(e, i) {
    if (matcher(e.message || '') || matcher(e.component || '')) findResults.push(i);
  });
  if (findResults.length) { findIdx = 0; scrollToFind(); }
  $('find-count').textContent = findResults.length
    ? (findIdx + 1) + ' / ' + findResults.length
    : 'No matches';
  vsStart = -1; vsEnd = -1; renderVS();
}

function buildMatcher(text, isRegex) {
  if (isRegex) {
    try { var re = new RegExp(text, 'i'); return function(s) { return re.test(s); }; }
    catch (_) { return null; }
  }
  var low = text.toLowerCase();
  return function(s) { return s && s.toLowerCase().indexOf(low) !== -1; };
}

function nextFind() {
  if (!findResults.length) return;
  findIdx = (findIdx + 1) % findResults.length;
  scrollToFind(); updateFindCount(); vsStart = -1; vsEnd = -1; renderVS();
}
function prevFind() {
  if (!findResults.length) return;
  findIdx = (findIdx - 1 + findResults.length) % findResults.length;
  scrollToFind(); updateFindCount(); vsStart = -1; vsEnd = -1; renderVS();
}
function scrollToFind() {
  if (findIdx < 0 || !findResults.length) return;
  logScrollWrap.scrollTop = findResults[findIdx] * ROW_HEIGHT - (logScrollWrap.clientHeight / 2);
}
function updateFindCount() {
  $('find-count').textContent = findResults.length
    ? (findIdx + 1) + ' / ' + findResults.length : 'No matches';
}
function clearFind() {
  findText = ''; findResults = []; findIdx = -1;
  if (findInput) findInput.value = '';
  if ($('find-count')) $('find-count').textContent = '';
  vsStart = -1; vsEnd = -1;
}

// ── Export CSV ─────────────────────────────────────────────────────────────
if (exportBtn) {
  exportBtn.onclick = function() {
    if (!filteredEntries.length) return;
    var rows = ['Source,Time,Date,Component,Thread,Delta,Type,Message'];
    filteredEntries.forEach(function(e, i) {
      var delta = i > 0 ? calcDelta(filteredEntries[i - 1], e) : '';
      var srcName = e._srcKey && openedFiles[e._srcKey] ? openedFiles[e._srcKey].name : '';
      rows.push([srcName, e.time||'', e.date||'', e.component||'', e.thread||'', delta, e.typeName||'Info', e.message||''].map(function(v) {
        var s = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? '"' + s + '"' : s;
      }).join(','));
    });
    var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aicmtrace-export.csv';
    a.click();
  };
}

// ── Status ─────────────────────────────────────────────────────────────────
function updateStatus() {
  var total = allEntries.length;
  var shown = filteredEntries.length;
  var errs = 0, warns = 0;
  allEntries.forEach(function(e) {
    if (e.type === 3) errs++;
    else if (e.type === 2) warns++;
  });
  var fileCount = Object.keys(openedFiles).length;
  statusEntries.textContent = total + ' entries' + (fileCount > 1 ? ' (' + fileCount + ' files)' : '');
  statusFiltered.textContent = shown !== total ? shown + ' shown' : '';
  statusErrors.textContent = (errs || warns) ? errs + ' errors  ' + warns + ' warnings' : '';
}

// ── Helpers ────────────────────────────────────────────────────────────────
function eh(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function ea(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Channel picker ─────────────────────────────────────────────────────────
var channelModal       = $('channel-modal');
var channelList        = $('channel-list');
var channelListLoading = $('channel-list-loading');
var channelSearch      = $('channel-search');
var allChannels        = null;

var COMMON_CHANNELS = [
  'Application', 'System', 'Setup',
  'Microsoft-Windows-PowerShell/Operational',
  'Microsoft-Windows-GroupPolicy/Operational',
  'Microsoft-Windows-WindowsUpdateClient/Operational',
  'Microsoft-Windows-DeviceManagement-Enterprise-Diagnostics-Provider/Admin',
  'Microsoft-Windows-Bits-Client/Operational',
  'Microsoft-Windows-TaskScheduler/Operational',
  'Microsoft-Windows-Sysmon/Operational',
];

$('channels-btn').onclick = function() {
  channelModal.classList.remove('hidden');
  if (channelSearch) { channelSearch.value = ''; channelSearch.focus(); }
  if (!allChannels) {
    channelListLoading.style.display = 'block';
    channelList.innerHTML = '';
    fetch('/api/evtx/channels')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        allChannels = data.channels || [];
        channelListLoading.style.display = 'none';
        renderChannelList('');
      })
      .catch(function(err) {
        channelListLoading.textContent = 'Failed to load: ' + err.message;
      });
  } else {
    renderChannelList(channelSearch ? channelSearch.value.trim() : '');
  }
};

function renderChannelList(filter) {
  if (!allChannels) return;
  var low = filter.toLowerCase();
  var matches = allChannels.filter(function(c) {
    return !low || c.toLowerCase().indexOf(low) !== -1;
  });
  var commonSet = {};
  COMMON_CHANNELS.forEach(function(c) { commonSet[c.toLowerCase()] = true; });
  matches.sort(function(a, b) {
    var ac = commonSet[a.toLowerCase()] ? 0 : 1;
    var bc = commonSet[b.toLowerCase()] ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return a.localeCompare(b);
  });
  if (!matches.length) {
    channelList.innerHTML = '<li style="color:var(--text3);cursor:default;">No channels match</li>';
    return;
  }
  var html = '';
  matches.forEach(function(c) {
    var isCommon = commonSet[c.toLowerCase()];
    html += '<li class="' + (isCommon ? 'evtx-common' : '') + '" data-channel="' + ea(c) + '" title="' + ea(c) + '">' + eh(c) + '</li>';
  });
  channelList.innerHTML = html;
  channelList.querySelectorAll('li[data-channel]').forEach(function(li) {
    li.onclick = function() {
      var ch = li.getAttribute('data-channel');
      closeChannelModal();
      switchTab('viewer');
      openChannel(ch);
    };
  });
}

function closeChannelModal() { channelModal.classList.add('hidden'); }

$('channel-modal-close').onclick = closeChannelModal;
channelModal.addEventListener('click', function(e) { if (e.target === channelModal) closeChannelModal(); });
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && !channelModal.classList.contains('hidden')) closeChannelModal();
});
if (channelSearch) {
  channelSearch.oninput = function() { renderChannelList(channelSearch.value.trim()); };
}

// ── Init ───────────────────────────────────────────────────────────────────
fetchBrowse(null).then(renderBrowser).catch(function() {
  fileList.innerHTML = '<li style="color:var(--row-err-fg);padding:8px;">Failed to load drives</li>';
});
renderOpenFilesList();
