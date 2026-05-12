#!/usr/bin/env python3
"""Clean write.css: remove v1 duplicate definitions that are overridden by v2."""

with open("write.css", "r") as f:
    lines = f.readlines()

total = len(lines)

# Line ranges to DELETE (1-indexed, inclusive) - v1 duplicates overridden by v2
# These are the v1 definitions of selectors that also appear in v2
delete_ranges = [
    (15, 23),     # .write-shell (v1) -> overridden by v2 L1569-1591
    (32, 39),     # .write-theme--light (v1) -> overridden by v2 L1593-1600
    (41, 50),     # .write-theme--dark (v1) -> overridden by v2 L1602-1619
    (52, 56),     # .write-theme--dark .write-shell, .write-focus-mode (v1) -> overridden by v2
    (228, 234),   # .write-workspace (v1) -> overridden by v2 L1622+
    (236, 243),   # .write-sidenav-toggle (v1) -> overridden by v2
    (245, 250),   # .write-sidenav-tools (v1) -> overridden by v2
    (603, 618),   # .write-icon-btn (v1) -> overridden by v2 L1637+
    (633, 641),   # .write-left-sidebar (v1) -> overridden by v2
    (642, 645),   # .write-left-sidebar.is-open (v1) -> overridden by v2
    (646, 652),   # .write-left-inner (v1) -> overridden by v2
    (667, 669),   # .write-main--with-rail (v1) -> overridden by v2
    (682, 701),   # .write-ai-rail (v1) -> overridden by v2 L2182+
    (703, 712),   # .write-rail-btn (v1) -> overridden by v2
    (714, 721),   # .write-rail-stack (v1) -> overridden by v2
    (723, 728),   # .write-rail-ai (v1) -> overridden by v2
    (730, 734),   # .write-rail-name (v1) -> overridden by v2
    (739, 743),   # .write-rail-btn.active (v1) -> overridden by v2
    (749, 763),   # .write-ai-drawer (v1) -> overridden by v2 L2229+
    (765, 772),   # .write-ai-drawer-head (v1) -> overridden by v2
    (791, 797),   # .write-ai-close (v1) -> no v2 but dead code (close btn moved)
    (799, 802),   # .write-ai-close:hover (v1) -> dead code
    (804, 808),   # .write-ai-drawer-body (v1) -> overridden by v2
    (810, 814),   # .write-ai-section (v1) -> overridden by v2
    (816, 825),   # .write-ai-section .hint (v1) -> overridden by v2
    (850, 858),   # .write-generate-tabs (v1) -> overridden by v2
    (860, 872),   # .write-generate-tab (v1) -> overridden by v2
    (874, 878),   # .write-generate-tab.is-active (v1) -> overridden by v2
    (892, 909),   # .write-summary-inspire-btn (v1) -> overridden by v2
    (916, 919),   # .write-summary-inspire-btn:disabled (v1) -> overridden by v2
    (921, 926),   # .write-summary-inspire-btn--with-text (v1) -> overridden by v2
    (928, 931),   # .write-summary-inspire-btn__icon (v1) -> overridden by v2
    (933, 940),   # .write-summary-inspire-btn__busy (v1) -> overridden by v2
    (942, 948),   # .write-summary-inspire-cta (v1) -> dead code
    (950, 955),   # .write-summary-inspire-tip (v1) -> dead code
    (963, 969),   # .write-ai-chat (v1) -> dead code (not used in current UI)
    (971, 978),   # .write-ai-messages (v1) -> dead code
    (980, 991),   # .write-ai-bubble (v1) -> overridden by v2
    (1001, 1007), # .write-ai-bubble--user (v1) -> overridden by v2
    (1009, 1015), # .write-ai-chat-input (v1) -> overridden by v2
    (1017, 1021), # .write-ai-chat-input .textarea (v1) -> overridden by v2
    (1023, 1027), # .write-ai-chat-input .btn (v1) -> dead code
    (1029, 1041), # .write-ai-naming-out (v1) -> dead code
    (1054, 1064), # .write-generate-lock (v1) -> overridden by v2
    (1070, 1083), # .write-generate-log (v1) -> overridden by v2
    (1085, 1095), # .write-eval-score (v1) -> overridden by v2
    (1097, 1103), # .write-eval-score-num (v1) -> overridden by v2
    (1105, 1109), # .write-eval-score-denom (v1) -> overridden by v2
    (1111, 1118), # .write-eval-score-label (v1) -> overridden by v2
    (1120, 1124), # .write-ai-section .btn (v1) -> overridden by v2
    (1126, 1129), # .write-ai-section .btn-primary (v1) -> overridden by v2
    (1137, 1142), # .write-ai-section .form-info (v1) -> dead code
    (1144, 1147), # .write-ai-section .form-error (v1) -> dead code
    (1149, 1152), # .write-ai-section .muted (v1) -> dead code
    (1163, 1166), # .editor-title--compact (v1) -> dead code (replaced by --improved)
    (1172, 1175), # .write-editor-card--dark (v1) -> overridden by v2 dark mode
    (1183, 1194), # .editor-title--improved (v1) -> overridden by v2 L1955+
    (1196, 1198), # .write-theme--dark .editor-title--improved (v1) -> overridden by v2
    (1206, 1208), # .write-body-wrapper--sm (v1) -> dead code (sm not used)
    (1210, 1212), # .write-body-wrapper--md (v1) -> overridden by v2
    (1214, 1216), # .write-body-wrapper--lg (v1) -> overridden by v2
    (1218, 1220), # .write-body-wrapper--xl (v1) -> dead code (xl not used)
    (1222, 1224), # .write-body-wrapper--full (v1) -> overridden by v2
    (1226, 1229), # .write-body-field (v1) -> overridden by v2
    (1231, 1239), # .write-editor-footer (v1) -> overridden by v2
    (1241, 1245), # .write-word-stats (v1) -> overridden by v2
    (1247, 1249), # .write-theme--dark .write-word-stats (v1) -> overridden by v2
    (1251, 1255), # .write-word-stat-item (v1) -> overridden by v2
    (1257, 1260), # .write-word-stat-label (v1) -> overridden by v2
    (1262, 1264), # .write-theme--dark .write-word-stat-label (v1) -> overridden by v2
    (1266, 1271), # .write-word-stat-value (v1) -> overridden by v2
    (1273, 1275), # .write-theme--dark .write-word-stat-value (v1) -> overridden by v2
    (1277, 1282), # .write-exit-focus-btn (v1) -> overridden by v2
    (1284, 1286), # .write-exit-focus-btn:hover (v1) -> overridden by v2
    (1288, 1292), # .write-empty-hint (v1) -> overridden by v2
    (1304, 1308), # .chapter-list (v1) -> overridden by v2
    (1315, 1327), # .chapter-item (v1) -> overridden by v2
    (1330, 1334), # .chapter-item.active (v1) -> overridden by v2
    (1336, 1340), # .chapter-item:hover (v1) -> overridden by v2
    (1351, 1354), # .chapter-del:hover (v1) -> overridden by v2
    (1360, 1368), # .editor-title (v1) -> overridden by v2
    (1369, 1376), # .editor-body (v1) -> overridden by v2
    (1378, 1380), # .editor-body--noto (v1) -> dead code (font variants not used)
    (1381, 1383), # .editor-body--song (v1) -> dead code
    (1384, 1386), # .editor-body--kai (v1) -> dead code
    (1387, 1389), # .editor-body--fang (v1) -> dead code
    (1390, 1392), # .editor-body--hei (v1) -> dead code
    (1393, 1395), # .editor-body--mono (v1) -> dead code
    (1397, 1399), # .editor-body--line-height-compact (v1) -> overridden by v2
    (1401, 1403), # .editor-body--line-height-normal (v1) -> overridden by v2
    (1405, 1407), # .editor-body--line-height-relaxed (v1) -> overridden by v2
    (1409, 1411), # .editor-body--line-height-loose (v1) -> overridden by v2
    (1414, 1428), # .write-selection-float (v1) -> overridden by v2
    (1430, 1443), # .write-selection-float__item (v1) -> overridden by v2
    (1449, 1452), # .write-selection-float__item:disabled (v1) -> overridden by v2
    (1454, 1459), # .write-selection-float__icon (v1) -> dead code
    (1461, 1463), # .write-selection-float__icon--stroke (v1) -> dead code
    (1465, 1475), # .write-selection-overlay (v1) -> dead code
    (1477, 1487), # .write-selection-card (v1) -> overridden by v2
    (1489, 1494), # .write-selection-card__title (v1) -> dead code
    (1496, 1508), # .write-selection-card__body (v1) -> dead code
    (1510, 1515), # .write-selection-card__disclaimer (v1) -> dead code
    (1517, 1525), # .write-selection-card__actions (v1) -> dead code
    (1527, 1531), # .write-selection-card__replace (v1) -> overridden by v2
    (1537, 1542), # .write-selection-card__actions-right (v1) -> dead code
    (1544, 1556), # .write-selection-icon-btn (v1) -> dead code
    (1563, 1566), # .write-selection-icon-btn:disabled (v1) -> dead code
]

# Sort and merge overlapping ranges
delete_ranges.sort()
merged = [delete_ranges[0]]
for start, end in delete_ranges[1:]:
    if start <= merged[-1][1] + 1:
        merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    else:
        merged.append((start, end))

# Build set of lines to delete (1-indexed)
delete_lines = set()
for start, end in merged:
    for i in range(start, end + 1):
        delete_lines.add(i)

# Also delete blank lines that become orphans at boundaries
# We'll handle this in post-processing

# Write cleaned file
new_lines = []
for i, line in enumerate(lines, 1):
    if i not in delete_lines:
        new_lines.append(line)

# Post-process: remove runs of 3+ blank lines
result = []
blank_count = 0
for line in new_lines:
    if line.strip() == '':
        blank_count += 1
        if blank_count <= 2:
            result.append(line)
    else:
        blank_count = 0
        result.append(line)

with open("write.css", "w") as f:
    f.writelines(result)

removed = len(lines) - len(result)
print(f"Original: {len(lines)} lines")
print(f"Removed: {removed} lines")
print(f"Result: {len(result)} lines")
print(f"Merged delete ranges: {merged}")
