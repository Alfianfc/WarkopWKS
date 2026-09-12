#!/usr/bin/env python3
"""kasir: escHtml di semua render + addToCart/openChangeImageModal anti-breakout."""
import sys

A = "C:/Users/user/Downloads/Coffe/kasir.html"

with open(A, 'r', encoding='utf-8') as f:
    s = f.read()

pairs = []

# H1. helper
pairs.append((
"""    // Escape untuk nama yang disisip ke onclick='...' (kutip + backslash)""",
"""    function escHtml(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Escape untuk string JS dalam onclick='...' (kutip + backslash + </script>)
    function escJs(s) {
      return String(s == null ? '' : s).replace(/\\u005c/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c').replace(/>/g, '\\x3e');
    }

    // Escape untuk nama yang disisip ke onclick='...' (kutip + backslash)""", 1))

# H2. safeName/safeImg pakai escJs
pairs.append((
"""        const safeName = escQuote(item.name);
        const safeImg = escQuote(item.image || '');""",
"""        const safeName = escJs(item.name);
        const safeImg = escJs(item.image || '');""", 1))

# H3. nama menu di kartu + cart
pairs.append((
'''            <span class="text-xs font-bold text-on-surface truncate" title="${item.name}">${item.name}</span>''',
'''            <span class="text-xs font-bold text-on-surface truncate" title="${escHtml(item.name)}">${escHtml(item.name)}</span>''', 1))
pairs.append((
'''              <span class="text-xs font-bold text-on-surface">${item.name}</span>''',
'''              <span class="text-xs font-bold text-on-surface">${escHtml(item.name)}</span>''', 1))

# H4. struk
pairs.append((
'''            <span>${it.name} x${it.qty}</span>''',
'''            <span>${escHtml(it.name)} x${it.qty}</span>''', 1))

# H5. riwayat: table + metode
pairs.append((
'''                <span class="text-xs font-bold text-on-surface">${tx.table}</span>''',
'''                <span class="text-xs font-bold text-on-surface">${escHtml(tx.table)}</span>''', 1))
pairs.append((
'''<span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant font-semibold">${tx.paymentMethod}</span>''',
'''<span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant font-semibold">${escHtml(tx.paymentMethod)}</span>''', 1))

# H6. belanja: note + kategori
pairs.append((
'''              <span class="text-xs font-bold text-on-surface">${exp.note}</span>''',
'''              <span class="text-xs font-bold text-on-surface">${escHtml(exp.note)}</span>''', 1))
pairs.append((
'''              <span class="text-[11px] text-on-surface-variant">${exp.category} • ${warkopSync.formatTime(exp.timestamp)}</span>''',
'''              <span class="text-[11px] text-on-surface-variant">${escHtml(exp.category)} • ${warkopSync.formatTime(exp.timestamp)}</span>''', 1))

failed = []
for i, (old, new, cnt) in enumerate(pairs):
    if old not in s:
        failed.append((i, old[:70]))
        continue
    s = s.replace(old, new, cnt)

if failed:
    print("FAILED:", len(failed))
    for i, preview in failed:
        print(f"  #{i}: {preview!r}")
    sys.exit(1)

with open(A, 'w', encoding='utf-8') as f:
    f.write(s)
print(f"[kasir-xss] OK ({len(pairs)} edits)")
