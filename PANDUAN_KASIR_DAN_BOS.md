# ☕ Panduan Lengkap Website Kasir Warkop WKS & Layar Bos Online Real-Time

Website ini dilengkapi sistem **Login Username & Password (Kasir & Bos)**, didukung **WebSocket Real-Time (Socket.io)**, dan siap dibuka secara publik dari HP atau laptop mana saja.

## ⏰ Shift Kerja (WIB)

| Shift | Jam | Keterangan |
| :--- | :--- | :--- |
| **Shift 1 (Pagi)** | 06.00 – 15.00 | Serah terima ke shift 2 jam 15.00 |
| **Shift 2 (Sore)** | 15.00 – 24.00 | Tutup warkop jam 24.00 |

- Setiap transaksi & pengeluaran otomatis ditandai shift-nya (transaksi 00.00–06.00 ikut hari bisnis sebelumnya).
- Halaman **kasir** bisa toggle statistik **Shift ini / Seharian**; halaman **bos** bisa filter **Seharian / Shift 1 / Shift 2**.
- Laporan "hari ini" memakai **tanggal lokal perangkat** (bukan UTC), jadi transaksi lewat tengah malam tidak lompat hari.

---

## 🔐 Akun Login Bawaan (Default)

Saat pertama kali membuka website, silakan gunakan kredensial berikut:

| Peran (Role) | Username | Password | Hak Akses |
| :--- | :--- | :--- | :--- |
| **Kasir Warkop** | `alfian` | `alfian3839` | Buat Pesanan, Hitung Kembalian, Catat Pengeluaran Belanja Bahan, Cetak Struk. *(Tidak bisa melihat laporan keuangan bos)* |
| **Bos / Owner** | `bos` | `bos123` | Akses Penuh: Omzet Bruto, Laba Bersih, Pengeluaran Modal, Live Feed, Rekap WhatsApp, Ekspor Excel, dan **Ganti Password**. |

> 🔑 **Catatan Keamanan:** Bos dapat mengganti password kasir maupun password bos kapan saja melalui tombol ikon kunci (**Kelola Akun**) di kanan atas layar Bos.

---

## 🚀 Cara Menjalankan Website

### Pilihan 1: Jalankan Server Lokal / WiFi Warkop (Rekomendasi Cepat)

Buka terminal di folder project ini (`c:\Users\user\Downloads\Coffe`), lalu ketik:

```bash
npm start
```

Hasil di layar terminal:
- **Di Laptop ini:** Buka `http://localhost:3000`
- **Di HP Kasir & HP Bos (WiFi yang sama):** Buka `http://192.168.1.215:3000` *(atau IP lokal laptop Anda)*

---

### Pilihan 2: Dapatkan Link Online Publik Gratis (Bisa Dibuka dari Mana Saja)

Jika Bos berada di rumah atau di luar warkop dan ingin membuka link website lewat internet:

#### Cara A: Gunakan Tunnel Instan (1 Perintah)
Pastikan server sedang berjalan (`npm start`), lalu buka terminal baru dan ketik:
```bash
npm run tunnel
```
Anda akan langsung mendapatkan link publik gratis (contoh: `https://warkop-pos.loca.lt`) yang bisa dikirim ke WhatsApp Bos untuk langsung dibuka dari HP di mana saja!

#### Cara B: Deploy Online Permanen ke Vercel (100% Gratis)
Project ini sudah dilengkapi konfigurasi `vercel.json`:
1. Buat akun di [vercel.com](https://vercel.com) (gratis).
2. Jalankan perintah `npx vercel` di folder project ini.
3. Anda akan mendapatkan URL permanen `https://warkop-anda.vercel.app` berfitur HTTPS aman yang aktif 24 jam non-stop!

> ⚠️ **Catatan Vercel:** `server.js` (Express + Socket.io) tidak berjalan di serverless Vercel — di deploy Vercel, realtime 100% lewat **Supabase** (aktifkan + isi kredensial di `supabase-client.js`). Socket.io hanya hidup saat `npm start` di laptop/PC warkop.

---

## 📱 Alur Penggunaan

```
[Buka Website] ──> [Portal Login: index.html]
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
   [Login Kasir]                 [Login Bos]
         │                             │
         ▼                             ▼
[aplikasi_kasir_warkop_mobile.html]  [dashboard_owner_detail_mobile.html]
  - POS & Katalog Menu                 - Omzet & Laba Bersih LIVE
  - Bayar Tunai / QRIS                 - Grafik Penjualan Per Jam
  - Catat Belanja Modal                - Live Feed Transaksi Masuk 🔔
  - Cetak Struk                        - Kirim Rekap ke WA Bos
                                       - Unduh Excel (.CSV)
                                       - Ganti Password Kasir/Bos
```

---

## 🔄 Pembuktian Real-Time (Uji Coba Langsung)
1. Buka `http://localhost:3000` di browser.
2. Login sebagai **Kasir** di Tab 1.
3. Buka tab baru / incognito, buka `http://localhost:3000` dan login sebagai **Bos** di Tab 2.
4. Di Tab Kasir, pilih menu kopi dan klik **Bayar**.
5. Seketika di Tab Bos, lonceng berbunyi 🔔, omzet bertambah, dan transaksi langsung muncul di Live Feed tanpa perlu me-refresh halaman!
