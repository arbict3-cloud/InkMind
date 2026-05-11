#!/usr/bin/env python3
"""Analyze write.css for duplicate/contradictory definitions between v1 and v2."""

import re

with open("write.css", "r") as f:
    lines = f.readlines()

total = len(lines)
print(f"Total lines: {total}")

# Find all top-level CSS selectors (not inside @media)
selector_pattern = re.compile(r'^(\.[a-zA-Z][\w-]*(?::[a-zA-Z][\w-]*)*(?:\s*[,.>~+]\s*\.?[a-zA-Z][\w-]*(?::[a-zA-Z][\w-]*)*)*)\s*\{')

# Track selectors and their line ranges
selector_ranges = []
i = 0
while i < total:
    line = lines[i].rstrip()
    m = selector_pattern.match(line)
    if m:
        sel = m.group(1).strip()
        # Find closing brace
        depth = 0
        start = i + 1  # 1-indexed
        for j in range(i, total):
            depth += lines[j].count('{') - lines[j].count('}')
            if depth <= 0:
                end = j + 1  # 1-indexed
                break
        else:
            end = total
        
        # Normalize selector for comparison
        sel_norm = re.sub(r'\s+', ' ', sel.strip())
        selector_ranges.append((sel_norm, start, end))
        i = end
    else:
        i += 1

# Find duplicates
seen = {}
duplicates = []
for sel, start, end in selector_ranges:
    if sel in seen:
        prev_start, prev_end = seen[sel]
        duplicates.append((sel, prev_start, prev_end, start, end))
    seen[sel] = (start, end)

print(f"\nFound {len(duplicates)} duplicate selectors:\n")
for sel, s1, e1, s2, e2 in duplicates:
    v1_size = e1 - s1 + 1
    v2_size = e2 - s2 + 1
    print(f"  {sel}")
    print(f"    v1: L{s1}-{e1} ({v1_size} lines)")
    print(f"    v2: L{s2}-{e2} ({v2_size} lines)")
    
    # Show v1 content
    v1_content = "".join(lines[s1-1:e1]).strip()
    v2_content = "".join(lines[s2-1:e2]).strip()
    
    if v1_content == v2_content:
        print(f"    IDENTICAL - v1 can be safely deleted")
    else:
        print(f"    DIFFERENT - v2 overrides v1")

# Identify v1-only selectors (not in v2)
v1_selectors = set()
v2_selectors = set()
for sel, start, end in selector_ranges:
    if start < 1568:
        v1_selectors.add(sel)
    else:
        v2_selectors.add(sel)

v1_only = v1_selectors - v2_selectors
v2_only = v2_selectors - v1_selectors

print(f"\nv1-only selectors ({len(v1_only)}):")
for sel in sorted(v1_only):
    for s, start, end in selector_ranges:
        if s == sel and start < 1568:
            print(f"  {sel} (L{start}-{end})")
            break

print(f"\nv2-only selectors ({len(v2_only)}):")
for sel in sorted(v2_only):
    for s, start, end in selector_ranges:
        if s == sel and start >= 1568:
            print(f"  {sel} (L{start}-{end})")
            break
