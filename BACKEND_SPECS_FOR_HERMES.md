# 📋 Backend Specifications & Handover Note for Hermes

Dokumen ini disiapkan untuk mempermudah **Hermes** dalam melanjutkan pengembangan backend, database, dan infrastruktur server.

---

## 📁 Struktur File Frontend & Kontrak Data Saat Ini

```
Coffe/
├── index.html                           # Portal Login (Kasir vs Bos)
├── kasir.html                           # Frontend POS Kasir (/kasir)
├── bos.html                             # Frontend Dashboard Owner LIVE (/bos)
├── auth.js                              # Client-side Auth & Role Guard
├── pos-sync.js                          # Client-side Sync Engine (Socket.io + Fallback)
├── server.js                            # Scaffold Server Express + Socket.io
├── package.json                         # Dependensi (express, socket.io, cors)
└── warkop_data.json                     # Penyimpanan data lokal saat ini
```

---

## 🔌 Kontrak Real-Time (WebSocket / Socket.io)

Frontend (`pos-sync.js`) sudah siap mendengarkan dan mengirim event berikut:

### 1. Transaksi Penjualan
- **Client Emit ke Server:**
  ```javascript
  socket.emit('tx:create', transactionObject);
  ```
- **Server Broadcast ke Semua Client (termasuk Layar Bos):**
  ```javascript
  socket.broadcast.emit('tx:new', transactionObject);
  ```

### 2. Pengeluaran Belanja Kasir (Modal/Bahan Baku)
- **Client Emit ke Server:**
  ```javascript
  socket.emit('exp:create', expenseObject);
  ```
- **Server Broadcast ke Semua Client:**
  ```javascript
  socket.broadcast.emit('exp:new', expenseObject);
  ```

### 3. Data Awal Saat Client Baru Terhubung
- **Server Mengirim Data Awal:**
  ```javascript
  socket.emit('initial:data', {
    transactions: [...],
    expenses: [...]
  });
  ```

---

## 🗄️ Skema Data (Data Schemas)

### Schema: `Transaction`
```typescript
interface Transaction {
  id: string;              // contoh: "TRX-MTWEE6EV"
  timestamp: string;       // ISO 8601 UTC
  shift: '1' | '2';        // Shift 1 = 06.00-15.00, Shift 2 = 15.00-24.00. Tutup hari 24.00, ikut tanggal kalender.
  cashier: string;         // nama user login (mis. "Kasir Warkop")
  customer: string;          // nama pelanggan bon (opsional)
  staff: boolean;            // true = jatah karyawan (harga staff)
  discount: number;          // selisih harga normal - harga staff (Rp)
  table: string;           // selalu "Takeaway" (pilihan meja dihapus)
  paymentMethod: string;   // "Tunai" | "QRIS"
  items: Array<{
    name: string;
    price: number;
    qty: number;
    subtotal: number;
    category?: 'coffee' | 'food' | 'snack';
  }>;
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  change: number;
  status: 'PAID' | 'BON'; // BON = belum bayar, tidak masuk omzet
}
```

### Schema: `Expense` (Pengeluaran Modal Kasir)
```typescript
interface Expense {
  id: string;              // contoh: "EXP-MTWEE6F2"
  timestamp: string;       // ISO 8601 UTC
  shift: '1' | '2';        // sama seperti Transaction
  cashier: string;         // nama user login
  category: string;        // "Es Batu" | "Air Galon" | "Gas Elpiji" | "Bahan Baku" | "Plastik & Kemasan" | "Listrik" | "Kebersihan" | bebas (custom)
  note: string;            // "Beli Es Batu 2 Bal + Air Galon"
  amount: number;          // Nominal rupiah
}
```

### Schema: `User`
```typescript
interface User {
  username: string;
  password: string; // TIDAK PERNAH di repo/anon: login via RPC pos_login, tabel users RLS-deny
  role: 'kasir' | 'bos';
  name: string;
}
```

---

## 🌐 Endpoint REST yang Sudah Tersedia di `server.js`

- `GET /api/health` — Health check
- `GET /api/data` — Mengambil seluruh data transaksi & pengeluaran
- `POST /api/transactions` — Menerima transaksi baru via HTTP
- `POST /api/expenses` — Menerima pengeluaran baru via HTTP

*Frontend sudah 100% responsif, memiliki fallback local/BroadcastChannel, audio chime sintetis, cetak struk, kalkulator kembalian, dan modal pergantian password.*
