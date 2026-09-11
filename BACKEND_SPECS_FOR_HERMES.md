# 📋 Backend Specifications & Handover Note for Hermes

Dokumen ini disiapkan untuk mempermudah **Hermes** dalam melanjutkan pengembangan backend, database, dan infrastruktur server.

---

## 📁 Struktur File Frontend & Kontrak Data Saat Ini

```
Coffe/
├── index.html                           # Portal Login (Kasir vs Bos)
├── aplikasi_kasir_warkop_mobile.html    # Frontend POS Kasir
├── dashboard_owner_detail_mobile.html   # Frontend Dashboard Owner / Bos LIVE
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
  cashier: string;         // "Kasir 1"
  table: string;           // "Meja 04" | "Bungkus / Takeaway"
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
  status: 'PAID' | 'CANCELLED';
}
```

### Schema: `Expense` (Pengeluaran Modal Kasir)
```typescript
interface Expense {
  id: string;              // contoh: "EXP-MTWEE6F2"
  timestamp: string;       // ISO 8601 UTC
  cashier: string;         // "Kasir 1"
  category: string;        // "Bahan Baku" | "Es & Air Minum" | "Gas & Listrik" | "Lain-lain"
  note: string;            // "Beli Es Batu 2 Bal + Air Galon"
  amount: number;          // Nominal rupiah
}
```

### Schema: `User`
```typescript
interface User {
  username: string;
  password: string; // Saat ini plaintext di local/sessionStorage, silakan ganti ke bcrypt hash
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
