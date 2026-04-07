'use strict';

// ── DSRegCmd Analyzer ──────────────────────────────────────────────────────

// Section header patterns
var SECTION_RE = /^\|\s+(.+?)\s+\|$/;
var KV_RE = /^\s+([A-Za-z][A-Za-z0-9 _-]+?)\s*:\s*(.*?)\s*$/;

function parseDsreg(text) {
  var sections = [];
  var current = null;

  text.split('\n').forEach(function(line) {
    var l = line.replace(/\r/g, '');

    if (/^\+[-+]+\+$/.test(l.trim())) return;

    var sm = SECTION_RE.exec(l);
    if (sm) {
      if (current) sections.push(current);
      current = { title: sm[1].trim(), pairs: [] };
      return;
    }

    var kvm = KV_RE.exec(l);
    if (kvm && current) {
      var key = kvm[1].trim();
      var val = kvm[2].trim();
      if (key && !/^[-=+]+$/.test(key)) {
        current.pairs.push({ key: key, value: val });
      }
    }
  });
  if (current && current.pairs.length) sections.push(current);
  return sections;
}

function buildFacts(sections) {
  var facts = {};
  sections.forEach(function(s) {
    s.pairs.forEach(function(p) {
      var k = p.key.replace(/\s+/g, '').toLowerCase();
      facts[k] = p.value;
    });
  });
  return facts;
}

function boolFact(v) {
  if (!v) return null;
  return /^yes|true|1$/i.test(v.trim());
}

// ── Diagnostic rules ───────────────────────────────────────────────────────
function analyzeIssues(facts) {
  var issues = [];

  function add(sev, title, desc, fix) {
    issues.push({ sev: sev, title: title, desc: desc, fix: fix });
  }

  var aadJoined   = boolFact(facts['azureadjoinedstatus'] || facts['azureadjoinedtype'] || facts['azureadjoined']);
  var domJoined   = boolFact(facts['domainjoined']);
  var wpJoined    = boolFact(facts['workplacejoined']);
  var prt         = boolFact(facts['azureadprt']);
  var mdmUrl      = facts['mdmurl'] || facts['mdmcomplianceurl'] || facts['devicemanagementurl'] || '';
  var certExp     = facts['certificateexpiry'] || facts['certexpiry'] || '';
  var tenantId    = facts['tenantid'] || '';
  var deviceId    = facts['deviceid'] || '';
  var ngc         = boolFact(facts['ngcset'] || facts['ngckeyid'] ? 'YES' : '');
  var enterpriseJoined = boolFact(facts['enterprisejoined']);
  var prtUpdate   = facts['azureadprtupdatetime'] || '';
  var syncJoined  = boolFact(facts['deviceauthstatus'] || '' );

  if (aadJoined === false && domJoined === false && wpJoined === false) {
    add('error', 'Device not joined to any directory',
      'The device is not Azure AD joined, domain joined, or workplace joined.',
      'Run dsregcmd /join or enroll via Settings > Accounts > Access work or school.');
  } else if (aadJoined === false && domJoined === true) {
    add('warning', 'Hybrid Azure AD join may not be complete',
      'Device is domain joined but AzureAdJoined = NO. Hybrid join may be pending or failed.',
      'Check the Microsoft Entra Connect sync status, and ensure the computer object is synced. Review the user device registration event log (Applications and Services\\Microsoft\\Windows\\User Device Registration).');
  } else if (aadJoined === false && !domJoined) {
    add('error', 'Device is not Azure AD joined',
      'AzureAdJoined is NO. Users will not receive AAD-backed SSO or Intune policies.',
      'Enroll device via Settings > Accounts > Access work or school, or re-run Azure AD join from the Out-of-Box Experience.');
  }

  if (prt === false) {
    add('error', 'No Azure AD Primary Refresh Token (PRT)',
      'AzureAdPrt = NO means users cannot get SSO tokens for Azure AD resources.',
      'Sign out and back in. If persistent, check network access to login.microsoftonline.com. Run: dsregcmd /refreshprt');
  } else if (prt === true && prtUpdate) {
    try {
      var updTime = new Date(prtUpdate);
      var ageHrs  = (Date.now() - updTime.getTime()) / 3600000;
      if (ageHrs > 4 && ageHrs < 8760) {
        add('warning', 'Azure AD PRT may be stale',
          'PRT last updated ' + Math.round(ageHrs) + ' hours ago. Expected renewal every ~1 hour when online.',
          'Ensure the device is connected to the internet and can reach login.microsoftonline.com.');
      }
    } catch (_) {}
  }

  if (!mdmUrl || mdmUrl === 'null' || mdmUrl === '-') {
    if (aadJoined === true) {
      add('warning', 'Device not enrolled in MDM',
      'No MDM URL detected. The device is Azure AD joined but may not be Intune-managed.',
      'Enroll via Settings > Accounts > Access work or school > Enroll only in device management, or check auto-enrollment policy in Entra ID.');
    }
  }

  if (certExp && certExp !== 'N/A' && certExp !== '-') {
    try {
      var expDate = new Date(certExp);
      var daysLeft = Math.round((expDate - Date.now()) / 86400000);
      if (daysLeft < 0) {
        add('error', 'Device certificate has expired',
          'The device certificate expired ' + Math.abs(daysLeft) + ' day(s) ago (' + certExp + ').',
          'Re-join the device to Azure AD, or use a certificate renewal GPO/Intune policy.');
      } else if (daysLeft < 30) {
        add('warning', 'Device certificate expiring soon',
          'Certificate expires in ' + daysLeft + ' day(s) (' + certExp + ').',
          'Ensure certificate auto-renewal is enabled or manually renew before expiry.');
      }
    } catch (_) {}
  }

  if (aadJoined === true && (!deviceId || deviceId === 'N/A' || deviceId === '-')) {
    add('warning', 'Device ID is missing',
      'Device appears Azure AD joined but no Device ID was found in the output.',
      'The device may have failed to register. Try re-joining or check Entra ID > Devices.');
  }

  if (aadJoined === true && (!tenantId || tenantId === 'N/A' || tenantId === '-')) {
    add('warning', 'Tenant ID is missing',
      'No Tenant ID found in dsregcmd output.',
      'This may indicate a partial or failed join. Re-run dsregcmd /status as the affected user.');
  }

  if (wpJoined === true && aadJoined !== true) {
    add('info', 'Workplace joined (BYOD registration)',
      'Device is workplace-joined (BYOD/MAM) but not fully Azure AD joined.',
      'This is expected for personal devices. For corporate devices, perform a full Azure AD join.');
  }

  if (!issues.length && aadJoined === true && prt === true) {
    add('info', 'Device registration looks healthy',
      'AzureAdJoined = YES and PRT is present. No obvious issues detected.',
      'Continue monitoring via the User Device Registration event log if issues are reported.');
  }

  return issues;
}

// ── Column resize ──────────────────────────────────────────────────────────
var DSREG_COL_MIN = 80;
var dsregKeyWidth = (function() {
  var v = parseInt(localStorage.getItem('aicm-dsreg-key'), 10);
  return isNaN(v) ? 200 : v;
})();

function applyDsregColTemplate() {
  document.documentElement.style.setProperty('--dsreg-key-width', dsregKeyWidth + 'px');
}
applyDsregColTemplate();

(function() {
  var dragging = false, startX = 0, startW = 0;
  var resultsEl = document.getElementById('dsreg-results');

  resultsEl.addEventListener('mousedown', function(e) {
    var h = e.target.closest('.dsreg-col-rz');
    if (!h) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = dsregKeyWidth;
    h.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    dsregKeyWidth = Math.max(DSREG_COL_MIN, startW + (e.clientX - startX));
    applyDsregColTemplate();
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    var active = resultsEl.querySelector('.dsreg-col-rz.active');
    if (active) active.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('aicm-dsreg-key', String(dsregKeyWidth));
  });

  // Double-click: reset column width on handle, show modal on KV/issue rows
  resultsEl.addEventListener('dblclick', function(e) {
    if (e.target.closest('.dsreg-col-rz')) {
      dsregKeyWidth = 200;
      applyDsregColTemplate();
      localStorage.setItem('aicm-dsreg-key', '200');
      return;
    }
    var kv = e.target.closest('.dsreg-kv');
    if (kv) {
      var key = kv.dataset.key || '';
      var val = kv.dataset.val || '';
      showFieldsModal('DSReg Field', [
        { label: 'Key',   value: key },
        { label: 'Value', value: val },
      ]);
      return;
    }
    var issue = e.target.closest('.dsreg-issue');
    if (issue) {
      showFieldsModal('Diagnostic Issue', [
        { label: 'Severity',       value: issue.dataset.sev || '' },
        { label: 'Title',          value: issue.dataset.title || '' },
        { label: 'Description',    value: issue.dataset.desc || '' },
        { label: 'Recommendation', value: issue.dataset.fix || '' },
      ]);
    }
  });
})();

// ── Render ─────────────────────────────────────────────────────────────────
function renderDsreg(text) {
  var resultsEl = document.getElementById('dsreg-results');
  if (!text.trim()) {
    resultsEl.innerHTML = '<div class="dsreg-empty">Nothing to analyze. Paste <code>dsregcmd /status</code> output on the left.</div>';
    return;
  }

  var sections = parseDsreg(text);
  if (!sections.length) {
    resultsEl.innerHTML = '<div class="dsreg-empty">Could not parse the input. Make sure you pasted the full output of <code>dsregcmd /status</code>.</div>';
    return;
  }

  var facts  = buildFacts(sections);
  var issues = analyzeIssues(facts);

  // Sticky column header with resize handle
  var html = '<div class="dsreg-col-header">' +
    '<span>Key</span>' +
    '<i class="dsreg-col-rz" title="Drag to resize"></i>' +
    '<span>Value</span>' +
    '</div>';

  // Issues section
  if (issues.length) {
    html += '<div class="dsreg-section"><div class="dsreg-section-title">&#128270; Diagnostic Issues (' + issues.length + ')</div>';
    html += '<ul class="dsreg-issues">';
    issues.forEach(function(issue) {
      html += '<li class="dsreg-issue sev-' + issue.sev + '"' +
        ' data-sev="' + ea(issue.sev) + '"' +
        ' data-title="' + ea(issue.title) + '"' +
        ' data-desc="' + ea(issue.desc) + '"' +
        ' data-fix="' + ea(issue.fix) + '"' +
        ' title="Double-click for full detail">' +
        '<div class="dsreg-issue-title sev-' + issue.sev + '">' +
          (issue.sev === 'error' ? '&#10060; ' : issue.sev === 'warning' ? '&#9888; ' : '&#8505; ') +
          eh(issue.title) + '</div>' +
        '<div class="dsreg-issue-desc">'  + eh(issue.desc) + '</div>' +
        '<div class="dsreg-issue-fix">&#128161; ' + eh(issue.fix)  + '</div>' +
        '</li>';
    });
    html += '</ul></div>';
  }

  // Raw KV sections
  sections.forEach(function(section) {
    if (!section.pairs.length) return;
    html += '<div class="dsreg-section">';
    html += '<div class="dsreg-section-title">' + eh(section.title) + '</div>';
    section.pairs.forEach(function(p) {
      var val = p.value;
      var valClass = '';
      if (/^YES$/i.test(val))   valClass = 'val-yes';
      else if (/^NO$/i.test(val)) valClass = 'val-no';
      else if (!val || val === 'N/A' || val === '-') { valClass = 'val-empty'; val = val || '(empty)'; }
      html += '<div class="dsreg-kv"' +
        ' data-key="' + ea(p.key) + '"' +
        ' data-val="' + ea(p.value) + '"' +
        ' title="Double-click to expand">' +
        '<span class="dsreg-key">' + eh(p.key) + '</span>' +
        '<span class="dsreg-spacer"></span>' +
        '<span class="dsreg-val ' + valClass + '">' + eh(val) + '</span>' +
        '</div>';
    });
    html += '</div>';
  });

  resultsEl.innerHTML = html;
}

// ── Wire up controls ───────────────────────────────────────────────────────
document.getElementById('dsreg-analyze-btn').onclick = function() {
  renderDsreg(document.getElementById('dsreg-textarea').value);
};

document.getElementById('dsreg-clear-btn').onclick = function() {
  document.getElementById('dsreg-textarea').value = '';
  document.getElementById('dsreg-results').innerHTML =
    '<div class="dsreg-empty" id="dsreg-empty">Paste <code>dsregcmd /status</code> output on the left and click <strong>Analyze</strong>.</div>';
};

document.getElementById('dsreg-load-file-btn').onclick = function() {
  document.getElementById('dsreg-file-input').click();
};

document.getElementById('dsreg-file-input').onchange = function(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    document.getElementById('dsreg-textarea').value = ev.target.result;
    renderDsreg(ev.target.result);
  };
  reader.readAsText(file);
};

document.getElementById('dsreg-textarea').addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    renderDsreg(document.getElementById('dsreg-textarea').value);
  }
});

function eh(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function ea(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
