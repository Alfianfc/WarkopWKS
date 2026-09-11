/**
 * Warkop POS & Owner Real-Time Sync Engine (Supabase Realtime + Local Cache)
 */

class WarkopSyncEngine {
  constructor() {
    this.channelName = 'warkop_realtime_channel';
    this.storageKeys = {
      transactions: 'warkop_transactions_v2',
      expenses: 'warkop_expenses_v2',
      menu: 'warkop_menu_v2',
      settings: 'warkop_settings_v2'
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
          } else if (type === 'MENU_UPDATED' || type === 'DATA_UPDATED') {
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
          if (data && Array.isArray(data)) {
            localStorage.setItem(this.storageKeys.menu, JSON.stringify(data));
            this.notifyListeners('dataChanged', this.getAllData());
          }
        })
        .subscribe();

      console.log('Supabase Realtime Sync active!');
    } catch (e) {
      console.warn('Supabase init notice:', e);
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
      // Audio autoplay policy
    }
  }

  initDefaultData() {
    const existing = localStorage.getItem(this.storageKeys.menu);
    let menuList = [];
    try {
      menuList = existing ? JSON.parse(existing) : [];
    } catch (e) {
      menuList = [];
    }

    if (!existing || !Array.isArray(menuList) || menuList.length < 30) {
      const defaultMenu = [
        // Minuman Dingin
        { id: 'menu-d-1', name: 'Es Teh', price: 5000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-2', name: 'Es White Coffee', price: 6000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-3', name: 'Es GulaAren', price: 6000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-4', name: 'Es GoodDay All Varian', price: 8000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-5', name: 'Es Dancow All Varian', price: 8000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-6', name: 'Es Chocolatos All varian', price: 7000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-7', name: 'Es Milo', price: 7000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1582293041079-7814c2f12063?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-8', name: 'Es Nutrisari', price: 5000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-9', name: 'Joshua', price: 8000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-10', name: 'Kukubima + Susu', price: 8000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-11', name: 'Kukubima', price: 6000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-12', name: 'Extra jos', price: 6000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1536935338788-846bb9981813?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-13', name: 'Air mineral Vit', price: 3000, category: 'cold_drink', image: 'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=400&q=80', is_default: true },

        // Minuman Panas / Hangat
        { id: 'menu-h-1', name: 'Teh panas', price: 4000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-2', name: 'Susu jahe', price: 5000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-3', name: 'Kopi jahe', price: 5000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-4', name: 'Kopisusu', price: 7000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-5', name: 'Kopi tubruk', price: 5000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-6', name: 'Kopi Spesial mix', price: 6000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-7', name: 'Whitecoffee', price: 5000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1507133750040-4a8f57021571?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-8', name: 'Kopi GulaAren', price: 5000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-9', name: 'Goodday All varian', price: 7000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-10', name: 'Milo', price: 6000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-h-11', name: 'Chocolatos All varian', price: 6000, category: 'hot_drink', image: 'https://images.unsplash.com/photo-1517578239113-b03992dcdd25?auto=format&fit=crop&w=400&q=80', is_default: true },

        // Makanan
        { id: 'menu-m-1', name: 'Indomie All varian', price: 6000, category: 'food', image: 'https://images.unsplash.com/photo-1612927601601-6638404737ce?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-m-2', name: 'Indomie + telur', price: 9000, category: 'food', image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=400&q=80', is_default: true },

        // Makanan Ringan
        { id: 'menu-s-1', name: 'Tahu Sumedang', price: 3000, category: 'snack', image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-2', name: 'Risol', price: 3000, category: 'snack', image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-3', name: 'Martabak', price: 4000, category: 'snack', image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-4', name: 'Tahu isi', price: 3000, category: 'snack', image: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-5', name: 'Pisang goreng', price: 3000, category: 'snack', image: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-6', name: 'Sate Telur puyuh', price: 3000, category: 'snack', image: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-7', name: 'Gerry', price: 1500, category: 'snack', image: 'https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-8', name: 'Malkis', price: 1500, category: 'snack', image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-9', name: 'Sukro', price: 1500, category: 'snack', image: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&w=400&q=80', is_default: true }
      ];
      localStorage.setItem(this.storageKeys.menu, JSON.stringify(defaultMenu));
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
      cashier: txData.cashier || 'Kasir',
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
      cashier: expData.cashier || 'Kasir',
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

  // --- Menu Management Engine ---
  getMenu() {
    try {
      const data = localStorage.getItem(this.storageKeys.menu);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  async addMenuItem(item) {
    const defaultImg = 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=400&q=80';
    const newItem = {
      id: 'menu-custom-' + Date.now().toString(36),
      name: item.name.trim(),
      price: Number(item.price) || 0,
      category: item.category || 'cold_drink',
      image: item.image && item.image.trim() ? item.image.trim() : defaultImg,
      is_default: false
    };

    const list = this.getMenu();
    list.push(newItem);
    localStorage.setItem(this.storageKeys.menu, JSON.stringify(list));

    if (this.channel) {
      this.channel.postMessage({ type: 'MENU_UPDATED', payload: newItem });
    }

    if (window.supabaseClient) {
      try {
        await window.supabaseClient.from('menu').insert([newItem]);
      } catch (err) {
        console.warn('Supabase add menu item error:', err);
      }
    }

    this.notifyListeners('dataChanged', this.getAllData());
    return newItem;
  }

  async updateMenuItemImage(id, newImageUrl) {
    const list = this.getMenu();
    const target = list.find(m => m.id === id);
    if (!target) return { success: false, message: 'Menu tidak ditemukan.' };

    target.image = newImageUrl;
    localStorage.setItem(this.storageKeys.menu, JSON.stringify(list));

    if (this.channel) {
      this.channel.postMessage({ type: 'MENU_UPDATED', payload: target });
    }

    if (window.supabaseClient) {
      try {
        await window.supabaseClient.from('menu').update({ image: newImageUrl }).eq('id', id);
      } catch (err) {
        console.warn('Supabase update menu image error:', err);
      }
    }

    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true };
  }

  async deleteMenuItem(id) {
    const list = this.getMenu();
    const item = list.find(m => m.id === id);

    if (!item) {
      return { success: false, message: 'Menu tidak ditemukan.' };
    }

    if (item.is_default) {
      return { success: false, message: 'Menu default bawaan warkop tidak dapat dihapus.' };
    }

    const updated = list.filter(m => m.id !== id);
    localStorage.setItem(this.storageKeys.menu, JSON.stringify(updated));

    if (this.channel) {
      this.channel.postMessage({ type: 'MENU_UPDATED', payload: { id, deleted: true } });
    }

    if (window.supabaseClient) {
      try {
        await window.supabaseClient.from('menu').delete().eq('id', id);
      } catch (err) {
        console.warn('Supabase delete menu error:', err);
      }
    }

    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true };
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
    const categoryTotals = {
      cold_drink: 0,
      hot_drink: 0,
      food: 0,
      snack: 0,
      coffee: 0,
      other: 0
    };

    filteredTx.forEach((tx) => {
      totalRevenue += (Number(tx.total) || 0);
      if (Array.isArray(tx.items)) {
        tx.items.forEach((it) => {
          totalItemsSold += (Number(it.qty) || 1);
          const cat = it.category || 'cold_drink';
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
