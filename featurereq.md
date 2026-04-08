# Feature Requests — AICMTrace

Features identified from CMTrace and OneTrace that are not currently implemented.
Grouped by category, roughly ordered by impact within each group.

---



## Multi-File Viewing

### FR-01 · Multi-tab interface
**Source:** OneTrace  
Open multiple log files in separate tabs (similar to browser tabs). Each tab maintains its own filter/find/tail state. Right-click tab menu: Close, Close All, Close All But This.

### FR-02 · Merge multiple log files
**Source:** CMTrace, OneTrace  
Open two or more log files and merge them into a single chronological view. Entries are interleaved by timestamp. Useful for correlating client + server logs side by side. Each entry retains a "source file" indicator column so origin is clear.

### FR-03 · Log Groups
**Source:** OneTrace  
Pre-configured and user-defined groups of related log files that open together in one action (e.g., "Intune IME", "Windows Update", "Co-management"). Groups defined in a JSON/XML config file. Clicking a group opens all its files as merged or tabbed view.

---

## Search & Filter

### FR-04 · Exclusion / negative filters
**Source:** CMTrace (filter column options), OneTrace  
Add an "Exclude" filter mode: lines matching the pattern are hidden rather than shown. Could be a `-` prefix in the filter box or a dedicated toggle. Allows filtering out noisy/verbose lines while keeping everything else.

### FR-05 · Column-specific filters
**Source:** CMTrace  
Filter on a specific column (Component, Thread, Date/Time) rather than the full line. Example: show only entries from component `ContentTransferManager`. Could be implemented as `component:ContentTransferManager` syntax in the filter box or via dropdown column pickers.

### FR-06 · Case-sensitive search toggle
**Source:** CMTrace (Highlight dialog has case-sensitive option)  
Add a case-sensitive toggle to both the toolbar filter and the Ctrl+F find bar. Currently all matching appears to be case-insensitive.

### FR-07 · Named filter profiles (saved searches)
**Source:** OneTrace  
Save the current filter state (text, severity, regex flag, exclusions) as a named profile. Load profiles from a dropdown. Stored in localStorage or a config file. Useful for repeatedly applying the same diagnostic filter set.

### FR-08 · Go to date/time
**Source:** CMTrace, OneTrace  
A "Go To Time" dialog: enter a date/time and the viewer jumps to the nearest log entry at or after that timestamp. Essential when working with large logs where you know the approximate time of an event.

### FR-09 · Time range filter
**Source:** CMTrace (time-based filter), OneTrace  
Filter the view to show only entries within a specific start/end time window. Could be a "Zoom to selection" action (select two rows → filter to that time range) or a date/time range picker.

---

## Highlights & Bookmarks

### FR-10 · Named highlight groups (multi-color)
**Source:** CMTrace, OneTrace  
Define multiple simultaneous highlights with different background/text colors. Example: highlight "error" in red, "download" in blue, "retry" in orange. Each highlight is a named rule (text or regex, optional case-sensitive). Rules are managed in a panel or dialog and persist across sessions.

### FR-11 · Thread highlighting
**Source:** CMTrace  
Highlight all entries belonging to a specific thread ID (matched by decimal or hex value in the Thread column). Useful for tracing a single execution path through a multi-threaded log.

### FR-12 · Bookmarks
**Source:** CMTrace, OneTrace  
Toggle a bookmark on any row (click gutter or keyboard shortcut). Navigate between bookmarks with Next Bookmark / Previous Bookmark (F2 / Shift+F2). Clear all bookmarks. Bookmarks visible as a colored indicator in the row gutter.

### FR-13 · Bookmark all search results
**Source:** OneTrace  
Single action to bookmark every row matching the current Find query. Allows marking all hits for later navigation even after the find bar is closed.

---

## Scrollbar & Navigation

### FR-14 · Scrollbar error/warning markers
**Source:** OneTrace  
Show colored tick marks on the vertical scrollbar at positions where errors (red) and warnings (yellow) exist. Gives an instant visual overview of log health and lets you click a tick to jump directly to that entry cluster. Similar to VS Code's minimap error indicators.

### FR-15 · Recent files list
**Source:** CMTrace (last 8 files), OneTrace (Recently Opened tab + taskbar jump list)  
Maintain a list of recently opened files/channels. Accessible from a "Recent" button or menu. Stored in localStorage. Clicking an entry re-opens it immediately without navigating the file browser.

---

## Display & Columns

### FR-16 · Column visibility toggle
**Source:** CMTrace (column configuration), OneTrace (add/remove columns)  
Allow the user to show/hide individual columns (Time, Date, Component, Thread, Delta, Type). Hidden columns are excluded from the rendered grid. Settings persist via localStorage.

### FR-17 · Word wrap toggle
**Source:** CMTrace (implicitly via Info pane), general log viewer feature  
Toggle word wrap on the Message column. When off (current behavior), long messages truncate with ellipsis and require the detail panel. When on, the row expands to show the full message inline. Variable row height rendering required.

### FR-18 · Persistent Info pane (split-panel detail view)
**Source:** CMTrace  
A persistent split pane below the log grid showing the full text of the selected entry with proper line breaks rendered. Currently AICMTrace shows a collapsible detail panel that overlaps the grid. A fixed bottom pane that doesn't obscure log rows would match CMTrace's workflow more closely.

---

## Utilities

### FR-19 · Error code lookup tool
**Source:** CMTrace (Tools → Error Lookup)  
A dialog where you type a decimal or hex error code and get the human-readable description. AICMTrace has `errorCodes.js` for inline resolution but no dedicated lookup UI. Surface this as a standalone tool (toolbar button or keyboard shortcut) that accepts arbitrary codes and displays their meaning.

### FR-20 · Copy selected rows to clipboard
**Source:** CMTrace (Tools → Copy to Clipboard, tab-separated columns)  
Copy one or more selected log entries to the clipboard as formatted text (tab-separated columns matching the current column layout, or raw message only). Multi-select with Shift+Click / Ctrl+Click. Currently the only export option is full CSV.

### FR-21 · Ignore existing lines (tail-from-end)
**Source:** CMTrace (Open dialog option)  
When opening a file for live tailing, offer an option to skip all existing content and only show new entries written after the file was opened. Useful for clearing noise from a large existing log before starting a repro.

### FR-22 · Remote / UNC path file open
**Source:** CMTrace (File → Open on Server)  
Support opening log files via UNC paths (e.g., `\\server\c$\Windows\CCM\Logs\`). The file browser currently only enumerates local drives. Requires either a UNC path input field or the ability to type a path directly into the file browser.

### FR-23 · Status message auto-formatting
**Source:** OneTrace (>> status message rendering, version 2111+)  
Lines beginning with `>>` in ConfigMgr logs are encoded status messages. Auto-decode and format these into human-readable text in the Message column.

---

## Priority Notes

- **FR-01** (tabs) and **FR-02** (merge) are the highest-impact parity features — OneTrace's defining differentiators over CMTrace.
- **FR-14** (scrollbar markers) has high visual impact for large logs with minimal architectural change.
- **FR-10** (highlight groups) + **FR-12** (bookmarks) are the most-cited CMTrace workflow features among sysadmin users.
- **FR-19** (error lookup UI) is low effort given `errorCodes.js` already exists — just needs a surface.
- **FR-15** (recent files) is low effort (localStorage) and high frequency of use.
