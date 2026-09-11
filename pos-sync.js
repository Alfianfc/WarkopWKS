/**
 * Warkop POS & Owner Real-Time Sync Engine (Supabase Realtime + Local Cache)
 */

class WarkopSyncEngine {
  constructor() {
    this.channelName = 'warkop_realtime_channel';
    this.storageKeys = {
      transactions: 'warkop_transactions_v1',
      expenses: 'warkop_expenses_v1',
      menu: 'warkop_menu_v1',
      settings: 'warkop_settings_v1'
    };

    this.listeners = {
      dataChanged: [],
      transactionAdded: [],
      expenseAdded: []
    };

    this.isSupabaseReady = false;
    this.isSocketReady = false;
    this.socket = null;

    this.initBroadcastChannel();
    this.initLocalStorageListener();
    this.initDefaultData();
    this.initSupabase();
    this.initSocketIO();
  }

  // --- BroadcastChannel for multi-tab sync ---
  initBroadcastChannel() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(this.channelName);
        this.channel.onmessage = (event) => {
          const { type, payload } = event.data || {};
          if (type === 'NEW_TRANSACTION') {
            this.playNotificationSound();
            this.notifyListeners('transactionAdded', payload);
            this.notifyListeners('dataChanged', this.getAllData());
          } else if (type === 'NEW_EXPENSE') {
            this.notifyListeners('expenseAdded', payload);
            this.notifyListeners('dataChanged', this.getAllData());
          } else if (type === 'DATA_UPDATED') {
            this.notifyListeners('dataChanged', this.getAllData());
          }
        };
      } catch (err) {
        console.warn('BroadcastChannel not supported:', err);
      }
    }
  }

  initLocalStorageListener() {
    window.addEventListener('storage', (e) => {
      if (Object.values(this.storageKeys).includes(e.key)) {
        this.notifyListeners('dataChanged', this.getAllData());
      }
    });
  }

  // --- Supabase Realtime & Remote Database Sync ---
  async initSupabase() {
    if (!window.supabaseClient) return;
    this.isSupabaseReady = true;

    try {
      // 1. Initial Data Fetch from Supabase
      const [txRes, expRes, menuRes] = await Promise.all([
        window.supabaseClient.from('transactions').select('*').order('timestamp', { ascending: false }).limit(100),
        window.supabaseClient.from('expenses').select('*').order('timestamp', { ascending: false }).limit(100),
        window.supabaseClient.from('menu').select('*')
      ]);

      if (!txRes.error && Array.isArray(txRes.data)) {
        localStorage.setItem(this.storageKeys.transactions, JSON.stringify(txRes.data));
      }
      if (!expRes.error && Array.isArray(expRes.data)) {
        localStorage.setItem(this.storageKeys.expenses, JSON.stringify(expRes.data));
      }
      if (!menuRes.error && Array.isArray(menuRes.data) && menuRes.data.length > 0) {
        localStorage.setItem(this.storageKeys.menu, JSON.stringify(menuRes.data));
      }

      this.notifyListeners('dataChanged', this.getAllData());

      // 2. Realtime Subscriptions
      window.supabaseClient
        .channel('warkop-realtime-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, (payload) => {
          const newTx = payload.new;
          const current = this.getTransactions();
          if (!current.some(t => t.id === newTx.id)) {
            current.unshift(newTx);
            localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));
            this.playNotificationSound();
            this.notifyListeners('transactionAdded', newTx);
            this.notifyListeners('dataChanged', this.getAllData());
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'expenses' }, (payload) => {
          const newExp = payload.new;
          const current = this.getExpenses();
          if (!current.some(e => e.id === newExp.id)) {
            current.unshift(newExp);
            localStorage.setItem(this.storageKeys.expenses, JSON.stringify(current));
            this.notifyListeners('expenseAdded', newExp);
            this.notifyListeners('dataChanged', this.getAllData());
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' }, async () => {
          const { data } = await window.supabaseClient.from('menu').select('*');
          if (data) {
            localStorage.setItem(this.storageKeys.menu, JSON.stringify(data));
            this.notifyListeners('dataChanged', this.getAllData());
          }
        })
        .subscribe();

      console.log('Supabase Realtime Sync active!');
    } catch (e) {
      console.warn('Supabase init failed, running local mode:', e);
    }
  }

  // --- Optional Socket.io Fallback ---
  initSocketIO() {
    if (typeof io !== 'undefined') {
      try {
        this.socket = io();
        this.socket.on('connect', () => {
          this.isSocketReady = true;
        });
        this.socket.on('tx:new', (tx) => {
          const current = this.getTransactions();
          if (!current.some(t => t.id === tx.id)) {
            current.unshift(tx);
            localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));
            this.playNotificationSound();
            this.notifyListeners('transactionAdded', tx);
            this.notifyListeners('dataChanged', this.getAllData());
          }
        });
        this.socket.on('exp:new', (exp) => {
          const current = this.getExpenses();
          if (!current.some(e => e.id === exp.id)) {
            current.unshift(exp);
            localStorage.setItem(this.storageKeys.expenses, JSON.stringify(current));
            this.notifyListeners('expenseAdded', exp);
            this.notifyListeners('dataChanged', this.getAllData());
          }
        });
      } catch (err) {
        // Silent
      }
    }
  }

  // --- Web Audio Notification ---
  playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {
      // Audio autoplay policy notice
    }
  }

  initDefaultData() {
    if (!localStorage.getItem(this.storageKeys.menu)) {
      const initialMenu = [
        { id: 'menu-1', name: 'Kopi Susu Warkop', price: 18000, category: 'coffee', image: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=300&q=80' },
        { id: 'menu-2', name: 'Indomie Telur Kornet', price: 15000, category: 'food', image: 'https://images.unsplash.com/photo-1612927601601-6638404737ce?auto=format&fit=crop&w=300&q=80' },
        { id: 'menu-3', name: 'Pisang Goreng Keju', price: 12000, category: 'snack', image: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=300&q=80' },
        { id: 'menu-4', name: 'Es Teh Manis', price: 5000, category: 'coffee', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=300&q=80' },
        { id: 'menu-5', name: 'Kopi Hitam Tubruk', price: 8000, category: 'coffee', image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=300&q=80' },
        { id: 'menu-6', name: 'Roti Bakar Cokelat Keju', price: 14000, category: 'snack', image: 'https://images.unsplash.com/photo-1584776296944-ab6fb57b0bdd?auto=format&fit=crop&w=300&q=80' }
      ];
      localStorage.setItem(this.storageKeys.menu, JSON.stringify(initialMenu));
    }
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  notifyListeners(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in listener for ${event}:`, e);
        }
      });
    }
  }

  getTransactions() {
    try {
      const data = localStorage.getItem(this.storageKeys.transactions);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  async addTransaction(txData) {
    const tx = {
      id: 'TRX-' + Date.now().toString(36).toUpperCase(),
      timestamp: new Date().toISOString(),
      cashier: txData.cashier || 'Kasir 1',
      table: txData.table || 'Takeaway',
      paymentMethod: txData.paymentMethod || 'Tunai',
      items: txData.items || [],
      subtotal: Number(txData.subtotal) || 0,
      tax: Number(txData.tax) || 0,
      total: Number(txData.total) || 0,
      paid: Number(txData.paid) || 0,
      change: Number(txData.change) || 0,
      status: 'PAID'
    };

    const current = this.getTransactions();
    current.unshift(tx);
    localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));

    if (this.channel) {
      this.channel.postMessage({ type: 'NEW_TRANSACTION', payload: tx });
    }

    if (window.supabaseClient) {
      try {
        await window.supabaseClient.from('transactions').insert([tx]);
      } catch (err) {
        console.warn('Supabase push tx notice:', err);
      }
    }

    if (this.socket && this.socket.connected) {
      this.socket.emit('tx:create', tx);
    }

    this.playNotificationSound();
    this.notifyListeners('transactionAdded', tx);
    this.notifyListeners('dataChanged', this.getAllData());
    return tx;
  }

  getExpenses() {
    try {
      const data = localStorage.getItem(this.storageKeys.expenses);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  async addExpense(expData) {
    const exp = {
      id: 'EXP-' + Date.now().toString(36).toUpperCase(),
      timestamp: new Date().toISOString(),
      cashier: expData.cashier || 'Kasir 1',
      category: expData.category || 'Bahan Baku',
      note: expData.note || 'Pengeluaran operasional',
      amount: Number(expData.amount) || 0
    };

    const current = this.getExpenses();
    current.unshift(exp);
    localStorage.setItem(this.storageKeys.expenses, JSON.stringify(current));

    if (this.channel) {
      this.channel.postMessage({ type: 'NEW_EXPENSE', payload: exp });
    }

    if (window.supabaseClient) {
      try {
        await window.supabaseClient.from('expenses').insert([exp]);
      } catch (err) {
        console.warn('Supabase push expense notice:', err);
      }
    }

    if (this.socket && this.socket.connected) {
      this.socket.emit('exp:create', exp);
    }

    this.notifyListeners('expenseAdded', exp);
    this.notifyListeners('dataChanged', this.getAllData());
    return exp;
  }

  getMenu() {
    try {
      const data = localStorage.getItem(this.storageKeys.menu);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  async saveMenu(menuList) {
    localStorage.setItem(this.storageKeys.menu, JSON.stringify(menuList));
    this.notifyListeners('dataChanged', this.getAllData());
  }

  getAllData() {
    return {
      transactions: this.getTransactions(),
      expenses: this.getExpenses(),
      menu: this.getMenu(),
      summary: this.getSummary()
    };
  }

  getSummary(dateFilter = 'today') {
    const transactions = this.getTransactions();
    const expenses = this.getExpenses();
    const todayStr = new Date().toISOString().split('T')[0];

    const filteredTx = transactions.filter((t) => {
      if (dateFilter === 'today') {
        return t.timestamp && t.timestamp.startsWith(todayStr);
      }
      return true;
    });

    const filteredExpenses = expenses.filter((e) => {
      if (dateFilter === 'today') {
        return e.timestamp && e.timestamp.startsWith(todayStr);
      }
      return true;
    });

    let totalRevenue = 0;
    let totalItemsSold = 0;
    const categoryTotals = { coffee: 0, food: 0, snack: 0, other: 0 };

    filteredTx.forEach((tx) => {
      totalRevenue += (Number(tx.total) || 0);
      if (Array.isArray(tx.items)) {
        tx.items.forEach((it) => {
          totalItemsSold += (Number(it.qty) || 1);
          const cat = it.category || 'coffee';
          if (categoryTotals[cat] !== undefined) {
            categoryTotals[cat] += (Number(it.subtotal) || (it.price * it.qty));
          } else {
            categoryTotals.other += (Number(it.subtotal) || (it.price * it.qty));
          }
        });
      }
    });

    let totalExpenses = 0;
    filteredExpenses.forEach((exp) => {
      totalExpenses += (Number(exp.amount) || 0);
    });

    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0';

    return {
      totalRevenue,
      totalExpenses,
      netProfit,
      profitMargin,
      totalOrders: filteredTx.length,
      totalItemsSold,
      filteredTx,
      filteredExpenses,
      categoryTotals
    };
  }

  formatRupiah(amount) {
    return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
  }

  formatTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
  }

  formatDateIndo(dateObj = new Date()) {
    return dateObj.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  generateWhatsAppSummary() {
    const summary = this.getSummary('today');
    const dateStr = this.formatDateIndo(new Date());

    let msg = `*📊 LAPORAN KASIR WARKOP REAL-TIME*\n`;
    msg += `📅 Tanggal: ${dateStr}\n`;
    msg += `🕒 Update: ${this.formatTime(new Date().toISOString())}\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 *Omzet Penjualan:* ${this.formatRupiah(summary.totalRevenue)}\n`;
    msg += `📉 *Belanja / Pengeluaran:* ${this.formatRupiah(summary.totalExpenses)}\n`;
    msg += `💵 *KAS BERSIH:* ${this.formatRupiah(summary.netProfit)}\n`;
    msg += `🧾 *Total Transaksi:* ${summary.totalOrders} struk (${summary.totalItemsSold} porsi)\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;

    if (summary.filteredExpenses.length > 0) {
      msg += `*Rincian Pengeluaran Hari Ini:*\n`;
      summary.filteredExpenses.forEach((e, idx) => {
        msg += `${idx + 1}. ${e.note} (${e.category}) : ${this.formatRupiah(e.amount)}\n`;
      });
      msg += `\n`;
    }

    msg += `_Laporan otomatis dibuat oleh Sistem Kasir Warkop POS._`;
    return encodeURIComponent(msg);
  }

  exportToCSV() {
    const summary = this.getSummary('all');
    let csv = 'ID Transaksi,Tanggal,Jam,Kasir,Meja,Metode Bayar,Rincian Pesanan,Subtotal,Pajak,Total,Status\n';

    summary.filteredTx.forEach((tx) => {
      const date = tx.timestamp ? new Date(tx.timestamp) : new Date();
      const dateStr = date.toISOString().split('T')[0];
      const timeStr = date.toLocaleTimeString('id-ID');
      const itemsDetail = (tx.items || []).map((i) => `${i.name} (${i.qty}x)`).join('; ');

      csv += `"${tx.id}","${dateStr}","${timeStr}","${tx.cashier}","${tx.table}","${tx.paymentMethod}","${itemsDetail}",${tx.subtotal},${tx.tax},${tx.total},"${tx.status}"\n`;
    });

    csv += '\n\nID Pengeluaran,Tanggal,Jam,Kasir,Kategori,Keterangan,Nominal\n';
    summary.filteredExpenses.forEach((exp) => {
      const date = exp.timestamp ? new Date(exp.timestamp) : new Date();
      const dateStr = date.toISOString().split('T')[0];
      const timeStr = date.toLocaleTimeString('id-ID');

      csv += `"${exp.id}","${dateStr}","${timeStr}","${exp.cashier}","${exp.category}","${exp.note}",${exp.amount}\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Laporan_Kasir_Warkop_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Global Singleton Instance
window.warkopSync = new WarkopSyncEngine();
