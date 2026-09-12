#!/usr/bin/env python3
"""bos: escHtml di semua render + toast aman."""
import sys

A = "C:/Users/user/Downloads/Coffe/bos.html"

with open(A, 'r', encoding='utf-8') as f:
    s = f.read()

pairs = []

# H1. helper sebelum MODAL TRANSAKSI
pairs.append((
"""    // --- MODAL TRANSAKSI ---""",
"""    function escHtml(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- MODAL TRANSAKSI ---""", 1))

# H2. toast: teks via innerText
pairs.append((
"""      toast.innerHTML = `<span class="material-symbols-outlined text-primary text-[18px]">notifications_active</span><span>${text}</span>`;""",
"""      toast.innerHTML = `<span class="material-symbols-outlined text-primary text-[18px]">notifications_active</span><span></span>`;
      toast.querySelector('span:last-child').innerText = text;""", 1))

# H3. itemsSummary (feed + riwayat owner)
pairs.append((
"""        const itemsSummary = (tx.items || []).map(i => `${i.name} (${i.qty}x)`).join(', ');""",
"""        const itemsSummary = (tx.items || []).map(i => `${escHtml(i.name)} (${i.qty}x)`).join(', ');""", -1))

# H4. table + metode + kasir (feed + riwayat)
pairs.append((
"""${tx.paymentMethod}</span>""",
"""${escHtml(tx.paymentMethod)}</span>""", -1))
pairs.append((
"""<span class="text-xs font-bold text-on-surface truncate">${tx.table}</span>""",
"""<span class="text-xs font-bold text-on-surface truncate">${escHtml(tx.table)}</span>""", -1))
pairs.append((
"""${tx.cashier} • ${warkopSync.formatTime(tx.timestamp)}""",
"""${escHtml(tx.cashier)} • ${warkopSync.formatTime(tx.timestamp)}""", -1))

# H5. belanja: note + kategori + kasir (2 view)
pairs.append((
"""<span class="text-xs font-bold text-on-surface">${exp.note}</span>""",
"""<span class="text-xs font-bold text-on-surface">${escHtml(exp.note)}</span>""", -1))
pairs.append((
"""${exp.category} • ${exp.cashier} • ${warkopSync.formatTime(exp.timestamp)}""",
"""${escHtml(exp.category)} • ${escHtml(exp.cashier)} • ${warkopSync.formatTime(exp.timestamp)}""", -1))

pairs.append((
"""<span class="text-xs font-bold text-on-surface flex-1 truncate">${name}</span>""",
"""<span class="text-xs font-bold text-on-surface flex-1 truncate">${escHtml(name)}</span>""", -1))
pairs.append((
"""tutup: ${r.closed_by}` : ''}""",
"""tutup: ${escHtml(r.closed_by)}` : ''}""", 1))

failed = []
for i, (old, new, cnt) in enumerate(pairs):
    if old not in s:
        failed.append((i, old[:70]))
        continue
    s = s.replace(old, new, cnt if cnt != -1 else -1)

if failed:
    print("FAILED:", len(failed))
    for i, preview in failed:
        print(f"  #{i}: {preview!r}")
    sys.exit(1)

with open(A, 'w', encoding='utf-8') as f:
    f.write(s)
print(f"[bos-xss] OK ({len(pairs)} edits)")
