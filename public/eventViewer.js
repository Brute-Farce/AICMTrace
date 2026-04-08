'use strict';

// ── Event Viewer Tab ──────────────────────────────────────────────────────
// Provides Windows Event Viewer-style channel browser with:
//  - Channel tree (Windows Logs + Apps & Services groups)
//  - Summary of Administrative Events table
//  - Severity + time-range filters
//  - Virtual-scrolled event entry list

(function() {

  // ── Constants ──────────────────────────────────────────────────────────
  var EV_ROW_HEIGHT  = 22;
  var EV_BUFFER      = 80;

  // Predefined tree structure
  var TREE = [
    {
      label: 'Windows Logs',
      icon: '&#128203;',
      channels: [
        { label: 'Application',       channel: 'Application' },
        { label: 'Security',          channel: 'Security' },
        { label: 'Setup',             channel: 'Setup' },
        { label: 'System',            channel: 'System' },
        { label: 'Forwarded Events',  channel: 'ForwardedEvents' },
      ]
    },
    {
      label: 'Applications and Services Logs',
      icon: '&#128196;',
      channels: [
        { label: 'PowerShell/Operational',    channel: 'Microsoft-Windows-PowerShell/Operational' },
        { label: 'Group Policy/Operational',  channel: 'Microsoft-Windows-GroupPolicy/Operational' },
        { label: 'Windows Update/Operational',channel: 'Microsoft-Windows-WindowsUpdateClient/Operational' },
        { label: 'DevMgmt/Admin',             channel: 'Microsoft-Windows-DeviceManagement-Enterprise-Diagnostics-Provider/Admin' },
        { label: 'BITS Client/Operational',   channel: 'Microsoft-Windows-Bits-Client/Operational' },
        { label: 'Task Scheduler/Operational',channel: 'Microsoft-Windows-TaskScheduler/Operational' },
        { label: 'Sysmon/Operational',        channel: 'Microsoft-Windows-Sysmon/Operational' },
        { label: 'DNS Client/Operational',    channel: 'Microsoft-Windows-DNS-Client/Operational' },
        { label: 'SMBClient/Operational',     channel: 'Microsoft-Windows-SMBClient/Operational' },
        { label: 'WinRM/Operational',         channel: 'Microsoft-Windows-WinRM/Operational' },
      ]
    }
  ];

  // ── State ──────────────────────────────────────────────────────────────
  var evAllEntries      = [];
  var evFilteredEntries = [];
  var evSeverity        = 0;   // 0=all 1=info 2=warn 3=error
  var evTimeHours       = 0;   // 0=all, else last N hours
  var evActiveChannel   = null;
  var evSelectedIdx     = -1;
  var evVsStart         = -1;
  var evVsEnd           = -1;
  var evLoading         = false;
  var evAllChannels     = null; // cached channel list for Browse All

  // ── DOM refs ────────────────────────────────────────────────────────────
  var evTree          = document.getElementById('ev-tree');
  var evScrollWrap    = document.getElementById('ev-scroll-wrap');
  var evScrollInner   = document.getElementById('ev-scroll-inner');
  var evLogHeader     = document.getElementById('ev-log-header');
  var evEmptyState    = document.getElementById('ev-empty-state');
  var evDetailPanel   = document.getElementById('ev-detail-panel');
  var evSummaryPanel  = document.getElementById('ev-summary-panel');
  var evSummaryBody   = document.getElementById('ev-summary-body');
  var evSummaryTable  = document.getElementById('ev-summary-table');
  var evSummaryRows   = document.getElementById('ev-summary-rows');
  var evSummaryEmpty  = document.getElementById('ev-summary-empty');
  var evTimeFilter    = document.getElementById('ev-time-filter');
  var evRefreshBtn    = document.getElementById('ev-refresh-btn');
  var evSummaryToggle = document.getElementById('ev-summary-toggle');
  var evSummaryToggleBtn = document.getElementById('ev-summary-toggle-btn');
  var evExportBtn     = document.getElementById('ev-export-btn');
  var evResizer       = document.getElementById('ev-resizer');
  var evTreePanel     = document.getElementById('ev-tree-panel');

  // ── Build channel tree ──────────────────────────────────────────────────
  function buildTree() {
    var html = '';
    TREE.forEach(function(group, gi) {
      var open = gi === 0 ? 'open' : '';
      html += '<div class="ev-tree-group ' + open + '" data-gi="' + gi + '">';
      html += '<div class="ev-tree-group-header">' +
        '<span class="arrow">&#9658;</span>' +
        '<span class="ev-tree-group-icon">' + group.icon + '</span>' +
        '<span>' + ehEv(group.label) + '</span>' +
        '</div>';
      html += '<div class="ev-tree-children">';
      group.channels.forEach(function(item) {
        html += '<div class="ev-tree-item" data-channel="' + eaEv(item.channel) + '" title="' + eaEv(item.channel) + '">' +
          '<span class="ev-item-icon">&#128196;</span>' +
          '<span>' + ehEv(item.label) + '</span>' +
          '</div>';
      });
      html += '<div class="ev-tree-item browse-all" data-browse="true" title="Browse all channels">' +
        '<span class="ev-item-icon">&#128269;</span>' +
        '<span>Browse All&#8230;</span>' +
        '</div>';
      html += '</div></div>';
    });
    evTree.innerHTML = html;

    // Group header toggle
    evTree.querySelectorAll('.ev-tree-group-header').forEach(function(hdr) {
      hdr.addEventListener('click', function() {
        var grp = hdr.parentElement;
        grp.classList.toggle('open');
      });
    });

    // Channel item click
    evTree.querySelectorAll('.ev-tree-item[data-channel]').forEach(function(item) {
      item.addEventListener('click', function() {
        evTree.querySelectorAll('.ev-tree-item').forEach(function(i) { i.classList.remove('active'); });
        item.classList.add('active');
        var ch = item.getAttribute('data-channel');
        loadChannel(ch);
      });
    });

    // Browse All
    evTree.querySelectorAll('.ev-tree-item[data-browse]').forEach(function(item) {
      item.addEventListener('click', function() {
        showBrowseAll();
      });
    });
  }

  // ── Load a channel ──────────────────────────────────────────────────────
  function loadChannel(channelName) {
    if (evLoading) return;
    evLoading = true;
    evActiveChannel = channelName;
    evAllEntries = [];
    evFilteredEntries = [];
    evSelectedIdx = -1;
    evVsStart = -1; evVsEnd = -1;
    evDetailPanel.classList.remove('visible');

    evScrollWrap.style.display = 'none';
    evLogHeader.style.display = 'none';
    evEmptyState.style.display = 'none';
    evScrollInner.innerHTML = '<div class="loading">Loading ' + ehEv(channelName) + '&#8230;</div>';
    evScrollWrap.style.display = 'block';
    evLogHeader.style.display = 'grid';

    // Clear summary while loading
    evSummaryTable.style.display = 'none';
    evSummaryEmpty.style.display = 'flex';
    evSummaryEmpty.textContent = 'Loading\u2026';

    fetch('/api/evtx?channel=' + encodeURIComponent(channelName))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        evLoading = false;
        if (data.error) throw new Error(data.error);
        evAllEntries = data.entries || [];
        applyEvFilter();
        buildSummary();
      })
      .catch(function(err) {
        evLoading = false;
        evScrollInner.innerHTML = '<div style="color:var(--row-err-fg);padding:10px;">&#10060; ' + ehEv(err.message) + '</div>';
        evSummaryEmpty.textContent = 'Failed to load: ' + err.message;
      });
  }

  // ── Severity + Time filter ──────────────────────────────────────────────
  function applyEvFilter() {
    var now = Date.now();
    var cutoffMs = evTimeHours > 0 ? now - (evTimeHours * 3600 * 1000) : 0;

    evFilteredEntries = evAllEntries.filter(function(e) {
      if (evSeverity > 0 && e.type !== evSeverity) return false;
      if (cutoffMs > 0 && e.isoTime) {
        var t = new Date(e.isoTime).getTime();
        if (!isNaN(t) && t < cutoffMs) return false;
      }
      return true;
    });

    evVsStart = -1; evVsEnd = -1;
    renderEvVS();
  }

  // Severity buttons
  document.querySelectorAll('.ev-sev-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      evSeverity = parseInt(btn.dataset.sev, 10) || 0;
      document.querySelectorAll('.ev-sev-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.sev === btn.dataset.sev);
      });
      applyEvFilter();
      buildSummary();
    });
  });

  // Time filter
  if (evTimeFilter) {
    evTimeFilter.addEventListener('change', function() {
      evTimeHours = parseInt(evTimeFilter.value, 10) || 0;
      applyEvFilter();
      buildSummary();
    });
  }

  // Refresh
  if (evRefreshBtn) {
    evRefreshBtn.addEventListener('click', function() {
      if (evActiveChannel) loadChannel(evActiveChannel);
    });
  }

  // ── Virtual scroll for Event Viewer ────────────────────────────────────
  if (evScrollWrap) evScrollWrap.addEventListener('scroll', renderEvVS);

  function renderEvVS() {
    var total = evFilteredEntries.length;
    if (!total) {
      evScrollInner.style.height = '0px';
      evScrollInner.innerHTML = '';
      if (evActiveChannel) {
        evScrollInner.innerHTML = '<div style="color:var(--text3);padding:16px;text-align:center;">No events match the current filters</div>';
      }
      return;
    }
    evScrollInner.style.height = (total * EV_ROW_HEIGHT) + 'px';

    var scrollTop = evScrollWrap.scrollTop;
    var viewH     = evScrollWrap.clientHeight || 400;
    var visStart  = Math.floor(scrollTop / EV_ROW_HEIGHT);
    var visEnd    = Math.ceil((scrollTop + viewH) / EV_ROW_HEIGHT);
    var start     = Math.max(0, visStart - EV_BUFFER);
    var end       = Math.min(total - 1, visEnd + EV_BUFFER);

    if (start === evVsStart && end === evVsEnd) return;
    evVsStart = start; evVsEnd = end;

    var frag = document.createDocumentFragment();
    for (var i = start; i <= end; i++) {
      frag.appendChild(buildEvRow(evFilteredEntries[i], i));
    }
    evScrollInner.innerHTML = '';
    evScrollInner.appendChild(frag);
  }

  function buildEvRow(entry, idx) {
    var div = document.createElement('div');
    div.className = 'ev-row type-' + (entry.type || 1);
    div.style.top = (idx * EV_ROW_HEIGHT) + 'px';
    div.dataset.idx = idx;
    if (idx === evSelectedIdx) div.classList.add('selected');

    var levelIcon = entry.type === 3 ? '&#10060;' : entry.type === 2 ? '&#9888;' : '&#8505;';
    var datetime  = (entry.date || '') + ' ' + (entry.time || '');

    div.innerHTML =
      '<span class="ev-col-level">'    + levelIcon + ' ' + ehEv(entry.typeName || 'Information') + '</span>' +
      '<span class="ev-col-datetime">' + ehEv(datetime.trim()) + '</span>' +
      '<span class="ev-col-source">'   + ehEv(entry.component || '') + '</span>' +
      '<span class="ev-col-id">'       + ehEv(entry.eventId   || '') + '</span>' +
      '<span class="ev-col-task">'     + ehEv(entry.thread    || '') + '</span>' +
      '<span class="ev-col-message">'  + ehEv((entry.message  || '').split('\n')[0]) + '</span>';

    div.addEventListener('click', function() {
      evSelectedIdx = idx;
      evScrollWrap.querySelectorAll('.ev-row.selected').forEach(function(r) { r.classList.remove('selected'); });
      div.classList.add('selected');
      showEvDetail(entry);
    });
    div.addEventListener('dblclick', function() { showEvModal(entry); });

    return div;
  }

  // ── Detail panel ────────────────────────────────────────────────────────
  function showEvDetail(entry) {
    evDetailPanel.innerHTML =
      '<strong>Source:</strong> ' + ehEv(entry.component || '') + '  ' +
      '<strong>Event ID:</strong> ' + ehEv(entry.eventId || '') + '\n' +
      '<strong>Message:</strong>\n' + ehEv(entry.message || entry.raw || '');
    evDetailPanel.classList.add('visible');
  }

  // ── Detail modal ─────────────────────────────────────────────────────────
  function showEvModal(entry) {
    var typeClass = entry.type === 3 ? 'val-error' : entry.type === 2 ? 'val-warning' : 'val-info';
    // Re-use the shared modal from app.js
    var titleEl = document.getElementById('modal-title-text');
    if (titleEl) titleEl.textContent = 'Event Log Entry \u2014 ' + (entry.component || '') + ' ' + (entry.eventId ? '#' + entry.eventId : '');
    var modalBody = document.getElementById('modal-body');
    if (!modalBody) return;
    var fields = [
      { label: 'Level',          value: entry.typeName  || 'Information', cls: typeClass },
      { label: 'Date / Time',    value: (entry.date || '') + ' ' + (entry.time || '') },
      { label: 'Event ID',       value: entry.eventId   || '' },
      { label: 'Channel / Log',  value: entry.channel   || evActiveChannel || '' },
      { label: 'Source',         value: entry.component || '' },
      { label: 'Computer',       value: entry.computer  || '' },
      { label: 'User',           value: entry.user      || '' },
      { label: 'Task Category',  value: entry.thread    || '' },
      { label: 'Keywords',       value: entry.keywords  || '' },
      { label: 'Message',        value: entry.message   || '' },
    ];
    var html = '';
    fields.forEach(function(f) {
      if (!f.value) return;
      html += '<div>' +
        '<div class="modal-field-label">'  + ehEv(f.label) + '</div>' +
        '<div class="modal-field-value ' + (f.cls || '') + '">' + ehEv(f.value) + '</div>' +
        '</div>';
    });
    modalBody.innerHTML = html;
    var rowModal = document.getElementById('row-modal');
    if (rowModal) rowModal.classList.remove('hidden');
    modalBody.scrollTop = 0;
  }

  // ── Summary of Administrative Events ────────────────────────────────────
  function buildSummary() {
    // Use the currently filtered entries so severity/time filters affect summary too
    var groups = {};
    evFilteredEntries.forEach(function(e) {
      if (e.type < 2) return; // errors and warnings only
      var key = [e.typeName, e.component, e.channel || evActiveChannel, e.eventId].join('\x00');
      if (!groups[key]) {
        groups[key] = {
          typeName:  e.typeName,
          typeNum:   e.type,
          source:    e.component  || '',
          log:       e.channel    || evActiveChannel || '',
          eventId:   e.eventId    || '',
          count:     0,
          lastIso:   '',
          lastLabel: ''
        };
      }
      groups[key].count++;
      var iso = e.isoTime || '';
      if (!groups[key].lastIso || iso > groups[key].lastIso) {
        groups[key].lastIso   = iso;
        groups[key].lastLabel = (e.date || '') + ' ' + (e.time || '');
      }
    });

    var rows = Object.keys(groups).map(function(k) { return groups[k]; }).sort(function(a, b) {
      if (a.typeNum !== b.typeNum) return b.typeNum - a.typeNum; // errors first
      return b.count - a.count;
    });

    if (!rows.length) {
      evSummaryTable.style.display = 'none';
      evSummaryEmpty.style.display = 'flex';
      evSummaryEmpty.textContent = evAllEntries.length
        ? 'No errors or warnings in this log'
        : 'Select a log from the tree to see event summary';
      return;
    }

    evSummaryEmpty.style.display = 'none';
    evSummaryTable.style.display = 'table';

    var html = '';
    rows.forEach(function(r) {
      var cls = r.typeNum === 3 ? 'ev-sum-type-error' : 'ev-sum-type-warn';
      html +=
        '<tr data-type="' + r.typeNum + '" data-src="' + eaEv(r.source) + '" data-eid="' + eaEv(r.eventId) + '">' +
        '<td class="' + cls + '">' + ehEv(r.typeName)  + '</td>' +
        '<td>' + ehEv(r.source)    + '</td>' +
        '<td>' + ehEv(r.log)       + '</td>' +
        '<td>' + ehEv(r.eventId)   + '</td>' +
        '<td class="ev-sum-count">' + r.count + '</td>' +
        '<td>' + ehEv(r.lastLabel.trim()) + '</td>' +
        '</tr>';
    });
    evSummaryRows.innerHTML = html;

    // Click a summary row to filter the list to matching entries
    evSummaryBody.querySelectorAll('tbody tr').forEach(function(tr) {
      tr.addEventListener('click', function() {
        var t   = parseInt(tr.dataset.type, 10);
        var src = tr.dataset.src;
        var eid = tr.dataset.eid;
        evFilteredEntries = evAllEntries.filter(function(e) {
          return e.type === t &&
            (e.component || '') === src &&
            (e.eventId || '') === eid;
        });
        evVsStart = -1; evVsEnd = -1;
        renderEvVS();
      });
    });
  }

  // ── Summary panel toggle ─────────────────────────────────────────────────
  if (evSummaryToggleBtn) {
    evSummaryToggleBtn.addEventListener('click', function() {
      var collapsed = evSummaryPanel.classList.toggle('collapsed');
      evSummaryToggleBtn.textContent = collapsed ? '\u25B6' : '\u25BC';
    });
  }
  // Toolbar summary toggle button
  if (evSummaryToggle) {
    evSummaryToggle.addEventListener('click', function() {
      var collapsed = evSummaryPanel.classList.toggle('collapsed');
      evSummaryToggle.classList.toggle('active', !collapsed);
      evSummaryToggleBtn.textContent = collapsed ? '\u25B6' : '\u25BC';
    });
  }

  // ── Event Viewer resizer ─────────────────────────────────────────────────
  if (evResizer && evTreePanel) {
    var evResizerActive = false;
    var evResizerStartX, evResizerStartW;
    evResizer.addEventListener('mousedown', function(e) {
      e.preventDefault();
      evResizerActive = true;
      evResizerStartX = e.clientX;
      evResizerStartW = evTreePanel.offsetWidth;
      evResizer.classList.add('dragging');
      document.body.style.cssText += 'cursor:col-resize!important;user-select:none!important';
    });
    document.addEventListener('mousemove', function(e) {
      if (!evResizerActive) return;
      var w = Math.max(160, Math.min(440, evResizerStartW + e.clientX - evResizerStartX));
      evTreePanel.style.width = w + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (!evResizerActive) return;
      evResizerActive = false;
      evResizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // ── Browse All (inline search in tree area) ──────────────────────────────
  function showBrowseAll() {
    // Show inline search at the bottom of the tree
    var existing = document.getElementById('ev-browse-all-panel');
    if (existing) { existing.remove(); return; }

    var panel = document.createElement('div');
    panel.id = 'ev-browse-all-panel';
    panel.style.cssText = 'padding:6px 8px;border-top:1px solid var(--border);background:var(--bg3);flex-shrink:0;';

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Search channels\u2026';
    inp.style.cssText = 'width:100%;background:var(--bg4);border:1px solid var(--btn-border);color:var(--text1);padding:4px 7px;font-family:inherit;font-size:12px;outline:none;border-radius:3px;';

    var list = document.createElement('ul');
    list.style.cssText = 'list-style:none;max-height:200px;overflow-y:auto;margin-top:4px;';

    panel.appendChild(inp);
    panel.appendChild(list);

    var evTreeWrap = document.getElementById('ev-tree-panel');
    if (evTreeWrap) evTreeWrap.appendChild(panel);

    function renderBrowseList(filter) {
      if (!evAllChannels) { list.innerHTML = '<li style="color:var(--text3);padding:6px;">Loading\u2026</li>'; return; }
      var low = filter.toLowerCase();
      var matches = evAllChannels.filter(function(c) {
        return !low || c.toLowerCase().indexOf(low) !== -1;
      }).slice(0, 100);
      if (!matches.length) { list.innerHTML = '<li style="color:var(--text3);padding:6px;">No match</li>'; return; }
      list.innerHTML = matches.map(function(c) {
        return '<li style="padding:3px 6px;font-size:11px;cursor:pointer;color:var(--text2);border-bottom:1px solid var(--bg1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + eaEv(c) + '" data-ch="' + eaEv(c) + '">' + ehEv(c) + '</li>';
      }).join('');
      list.querySelectorAll('li[data-ch]').forEach(function(li) {
        li.addEventListener('mouseenter', function() { li.style.background = 'var(--bg4)'; });
        li.addEventListener('mouseleave', function() { li.style.background = ''; });
        li.addEventListener('click', function() {
          evTree.querySelectorAll('.ev-tree-item').forEach(function(i) { i.classList.remove('active'); });
          loadChannel(li.getAttribute('data-ch'));
          panel.remove();
        });
      });
    }

    if (!evAllChannels) {
      list.innerHTML = '<li style="color:var(--accent);padding:6px;">Loading channels\u2026</li>';
      fetch('/api/evtx/channels')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          evAllChannels = data.channels || [];
          renderBrowseList(inp.value.trim());
        })
        .catch(function() { list.innerHTML = '<li style="color:var(--row-err-fg);padding:6px;">Failed to load</li>'; });
    } else {
      renderBrowseList('');
    }

    inp.addEventListener('input', function() { renderBrowseList(inp.value.trim()); });
    inp.focus();
  }

  // ── Export CSV ────────────────────────────────────────────────────────────
  if (evExportBtn) {
    evExportBtn.addEventListener('click', function() {
      if (!evFilteredEntries.length) return;
      var rows = ['Level,Date,Time,Source,EventID,TaskCategory,Computer,Message'];
      evFilteredEntries.forEach(function(e) {
        rows.push([
          e.typeName || '', e.date || '', e.time || '',
          e.component || '', e.eventId || '', e.thread || '',
          e.computer || '', e.message || ''
        ].map(function(v) {
          var s = String(v).replace(/"/g, '""');
          return /[,"\n]/.test(s) ? '"' + s + '"' : s;
        }).join(','));
      });
      var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (evActiveChannel || 'events').replace(/[/\\:*?"<>|]/g, '_') + '-export.csv';
      a.click();
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function ehEv(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function eaEv(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  buildTree();

})();
