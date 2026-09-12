const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'warkop_data.json');

// --- Persistent Data Storage ---
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data file:', e);
  }
  return {
    transactions: [],
    expenses: []
  };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving data file:', e);
  }
}

let db = loadData();

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- REST Endpoints ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), totalTransactions: db.transactions.length });
});

app.get('/api/data', (req, res) => {
  res.json(db);
});

app.post('/api/transactions', (req, res) => {
  const tx = req.body;
  if (!tx || !tx.id) {
    return res.status(400).json({ error: 'Data transaksi tidak valid' });
  }
  db.transactions.unshift(tx);
  saveData(db);
  io.emit('tx:new', tx);
  res.json({ success: true, transaction: tx });
});

app.post('/api/expenses', (req, res) => {
  const exp = req.body;
  if (!exp || !exp.id) {
    return res.status(400).json({ error: 'Data pengeluaran tidak valid' });
  }
  db.expenses.unshift(exp);
  saveData(db);
  io.emit('exp:new', exp);
  res.json({ success: true, expense: exp });
});

app.delete('/api/transactions/:id', (req, res) => {
  const { id } = req.params;
  const before = db.transactions.length;
  db.transactions = db.transactions.filter(t => t.id !== id);
  if (db.transactions.length === before) {
    return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
  }
  saveData(db);
  io.emit('tx:deleted', { id });
  res.json({ success: true, id });
});

app.put('/api/transactions/:id', (req, res) => {
  const { id } = req.params;
  const patch = req.body || {};
  delete patch.id;
  const tx = db.transactions.find(t => t.id === id);
  if (!tx) {
    return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
  }
  Object.assign(tx, patch);
  saveData(db);
  io.emit('tx:updated', { id, patch });
  res.json({ success: true, id });
});

app.delete('/api/expenses/:id', (req, res) => {
  const { id } = req.params;
  const before = db.expenses.length;
  db.expenses = db.expenses.filter(e => e.id !== id);
  if (db.expenses.length === before) {
    return res.status(404).json({ error: 'Pengeluaran tidak ditemukan' });
  }
  saveData(db);
  io.emit('exp:deleted', { id });
  res.json({ success: true, id });
});

// URL bersih: /kasir dan /bos (sama seperti di Vercel)
app.get('/kasir', (req, res) => {
  res.sendFile(path.join(__dirname, 'kasir.html'));
});

app.get('/bos', (req, res) => {
  res.sendFile(path.join(__dirname, 'bos.html'));
});

// Default route ke index.html (Portal Login)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- WebSocket Real-Time Events ---
io.on('connection', (socket) => {
  console.log(`[WebSocket] Client terhubung: ${socket.id}`);

  // Kirim data awal ke client baru
  socket.emit('initial:data', {
    transactions: db.transactions,
    expenses: db.expenses
  });

  // Saat kasir membuat transaksi baru
  socket.on('tx:create', (tx) => {
    console.log(`[Transaksi Baru] ${tx.id} - ${tx.table} - Rp ${tx.total}`);
    if (!db.transactions.some(t => t.id === tx.id)) {
      db.transactions.unshift(tx);
      saveData(db);
    }
    // Broadcast ke SEMUA client termasuk layar Bos
    socket.broadcast.emit('tx:new', tx);
  });

  // Saat kasir mencatat pengeluaran modal baru
  socket.on('exp:create', (exp) => {
    console.log(`[Pengeluaran Baru] ${exp.id} - ${exp.note} - Rp ${exp.amount}`);
    if (!db.expenses.some(e => e.id === exp.id)) {
      db.expenses.unshift(exp);
      saveData(db);
    }
    // Broadcast ke SEMUA client termasuk layar Bos
    socket.broadcast.emit('exp:new', exp);
  });

  // Hapus transaksi salah input (kasir & owner)
  socket.on('tx:delete', ({ id }) => {
    console.log(`[Hapus Transaksi] ${id}`);
    db.transactions = db.transactions.filter(t => t.id !== id);
    saveData(db);
    socket.broadcast.emit('tx:deleted', { id });
  });

  // Update transaksi (pelunasan bon)
  socket.on('tx:update', ({ id, patch }) => {
    console.log(`[Update Transaksi] ${id}`);
    db.transactions = db.transactions.map(t => t.id !== id ? t : { ...t, ...patch });
    saveData(db);
    socket.broadcast.emit('tx:updated', { id, patch });
  });

  // Hapus pengeluaran salah input (kasir & owner)
  socket.on('exp:delete', ({ id }) => {
    console.log(`[Hapus Pengeluaran] ${id}`);
    db.expenses = db.expenses.filter(e => e.id !== id);
    saveData(db);
    socket.broadcast.emit('exp:deleted', { id });
  });

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Client terputus: ${socket.id}`);
  });
});

// Dapatkan IP lokal untuk akses via HP di WiFi yang sama
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log('====================================================');
  console.log('☕ SERVER POS WARKOP REAL-TIME BERHASIL DIJALANKAN!');
  console.log('====================================================');
  console.log(`👉 Buka di Komputer Ini : http://localhost:${PORT}`);
  console.log(`📱 Buka di HP Kasir / Bos: http://${localIP}:${PORT}`);
  console.log('----------------------------------------------------');
  console.log('🔐 Akun Kasir : username: alfian (lihat PANDUAN_KASIR_DAN_BOS.md)');
  console.log('👑 Akun Bos   : username: bos (lihat PANDUAN_KASIR_DAN_BOS.md)');
  console.log('====================================================');
});
