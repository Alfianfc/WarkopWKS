/**
 * Warkop POS & Owner Real-Time Sync Engine (Supabase Realtime + Local Cache)
 */

class WarkopSyncEngine {
  constructor() {
    this.channelName = 'warkop_realtime_channel';
    this.isDemo = (window.warkopAuth && typeof window.warkopAuth.isDemo === 'function' && window.warkopAuth.isDemo());

    if (this.isDemo) {
      this.channelName = 'warkop_demo_channel';
      this.storageKeys = {
        transactions: 'warkop_demo_transactions_v2',
        expenses: 'warkop_demo_expenses_v2',
        menu: 'warkop_demo_menu_v2',
        settings: 'warkop_demo_settings_v2'
      };
    } else {
      this.storageKeys = {
        transactions: 'warkop_transactions_v2',
        expenses: 'warkop_expenses_v2',
        menu: 'warkop_menu_v2',
        settings: 'warkop_settings_v2'
      };
    }

    this.listeners = {
      dataChanged: [],
      transactionAdded: [],
      expenseAdded: [],
      transactionDeleted: [],
      expenseDeleted: [],
      cashChanged: []
    };

    this.isSupabaseReady = false;
    this.isSocketReady = false;
    this.socket = null;

    this.initBroadcastChannel();
    this.initLocalStorageListener();

    if (this.isDemo) {
      this.isSupabaseReady = true;
      this.isSocketReady = true;
      const loader = document.getElementById('app-loading');
      if (loader) loader.style.display = 'none';
      try { this.initDefaultData(); } catch (e) {}
      try { this.initDemoData(); } catch (e) { console.warn('init demo notice:', e); }
    } else {
      try { this.initDefaultData(); } catch (e) { console.warn('init menu notice:', e); }
      try { this.initSupabase(); } catch (e) { console.warn('init cloud notice:', e); }
      try { this.initSocketIO(); } catch (e) { console.warn('init socket notice:', e); }
    }
  }

  canSyncRemote() {
    return !this.isDemo && !!window.supabaseClient;
  }

  canSocket() {
    return !this.isDemo && !!(this.socket && this.socket.connected);
  }

  resetDemoData() {
    if (!this.isDemo) return;
    localStorage.removeItem(this.storageKeys.transactions);
    localStorage.removeItem(this.storageKeys.expenses);
    localStorage.removeItem(this.cashStoreKey());
    this.initDemoData(true);
    this.notifyListeners('dataChanged', this.getAllData());
    this.notifyListeners('cashChanged', this.getCashSessions());
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
          } else if (type === 'UPDATE_TRANSACTION') {
            const current = this.getTransactions().map(t => t.id !== payload.id ? t : { ...t, ...payload.patch });
            localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));
            this.notifyListeners('dataChanged', this.getAllData());
          } else if (type === 'DELETE_TRANSACTION') {
            const current = this.getTransactions().filter(t => t.id !== payload.id);
            localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));
            this.notifyListeners('transactionDeleted', payload);
            this.notifyListeners('dataChanged', this.getAllData());
          } else if (type === 'DELETE_EXPENSE') {
            const current = this.getExpenses().filter(e => e.id !== payload.id);
            localStorage.setItem(this.storageKeys.expenses, JSON.stringify(current));
            this.notifyListeners('expenseDeleted', payload);
            this.notifyListeners('dataChanged', this.getAllData());
          } else if (type === 'CASH_UPDATED') {
            this.refreshCashSessions();
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

  // Tulis localStorage yang tahan kuota penuh (return false kalau gagal)
  safeSet(key, val) {
    try {
      localStorage.setItem(key, val);
      return true;
    } catch (e) {
      console.warn('localStorage penuh, pakai memori sementara:', e);
      this._memFallback = this._memFallback || {};
      this._memFallback[key] = val;
      return false;
    }
  }

  safeGet(key) {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return v;
    } catch (e) {}
    return (this._memFallback || {})[key] || null;
  }

  // --- Fake Demo Data Generator (Mode Owner Demo) ---
  initDemoData(forceReset = false) {
    if (!this.isDemo) return;
    const existingTx = this.safeGet(this.storageKeys.transactions);
    if (existingTx && !forceReset) {
      try {
        const parsed = JSON.parse(existingTx);
        if (Array.isArray(parsed) && parsed.length > 0) return;
      } catch (e) {}
    }

    const now = new Date();
    const makeDate = (daysAgo, hour, min) => {
      const d = new Date(now);
      d.setDate(d.getDate() - daysAgo);
      d.setHours(hour, min, 0, 0);
      return d.toISOString();
    };

    const shiftOf = (iso) => {
      const h = new Date(iso).getHours();
      return (h >= 6 && h < 15) ? '1' : '2';
    };

    const txTemplate = [
      // H-0 (Hari Ini)
      { d: 0, h: 7, m: 30, table: 'Meja 02', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [
        { name: 'Es Teh', qty: 2, price: 5000, category: 'cold_drink', subtotal: 10000 },
        { name: 'Gorengan', qty: 3, price: 2000, category: 'snack', subtotal: 6000 }
      ]},
      { d: 0, h: 8, m: 15, table: 'Meja 01', cashier: 'Kasir Shift 1', pay: 'QRIS', items: [
        { name: 'Indomie + telur', qty: 1, price: 9000, category: 'food', subtotal: 9000 },
        { name: 'Kopi tubruk', qty: 1, price: 5000, category: 'hot_drink', subtotal: 5000 }
      ]},
      { d: 0, h: 9, m: 45, table: 'Takeaway', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [
        { name: 'Air mineral Vit', qty: 2, price: 3000, category: 'inventory', subtotal: 6000 },
        { name: 'Sukro', qty: 2, price: 1500, category: 'inventory', subtotal: 3000 }
      ]},
      { d: 0, h: 11, m: 20, table: 'Meja 03', cashier: 'Kasir Shift 1', pay: 'QRIS', items: [
        { name: 'Kopisusu', qty: 2, price: 7000, category: 'hot_drink', subtotal: 14000 },
        { name: 'Risol', qty: 4, price: 3000, category: 'snack', subtotal: 12000 }
      ]},
      { d: 0, h: 12, m: 40, table: 'Meja 04', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [
        { name: 'Indomie All varian', qty: 2, price: 6000, category: 'food', subtotal: 12000 },
        { name: 'Es GoodDay All Varian', qty: 2, price: 8000, category: 'cold_drink', subtotal: 16000 },
        { name: 'Ice batu Cristal', qty: 2, price: 1000, category: 'inventory', subtotal: 2000 }
      ]},
      { d: 0, h: 14, m: 10, table: 'Meja 02', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [
        { name: 'Teh panas', qty: 1, price: 4000, category: 'hot_drink', subtotal: 4000 },
        { name: 'Malkis', qty: 2, price: 1500, category: 'inventory', subtotal: 3000 }
      ]},
      { d: 0, h: 15, m: 30, table: 'Meja 05', cashier: 'Kasir Shift 2', pay: 'QRIS', items: [
        { name: 'Es Milo', qty: 2, price: 7000, category: 'cold_drink', subtotal: 14000 },
        { name: 'Pisang goreng', qty: 3, price: 3000, category: 'snack', subtotal: 9000 }
      ]},
      { d: 0, h: 17, m: 15, table: 'Meja 01', cashier: 'Kasir Shift 2', pay: 'Tunai', items: [
        { name: 'Joshua', qty: 1, price: 8000, category: 'cold_drink', subtotal: 8000 },
        { name: 'Martabak', qty: 2, price: 3000, category: 'snack', subtotal: 6000 }
      ]},
      { d: 0, h: 18, m: 50, table: 'Meja 06', cashier: 'Kasir Shift 2', pay: 'QRIS', items: [
        { name: 'Kopi Spesial mix', qty: 2, price: 6000, category: 'hot_drink', subtotal: 12000 },
        { name: 'Tahu Sumedang', qty: 4, price: 3000, category: 'snack', subtotal: 12000 }
      ]},
      { d: 0, h: 20, m: 15, table: 'Meja 03', cashier: 'Kasir Shift 2', pay: 'Tunai', items: [
        { name: 'Indomie + telur', qty: 3, price: 9000, category: 'food', subtotal: 27000 },
        { name: 'Es Teh', qty: 3, price: 5000, category: 'cold_drink', subtotal: 15000 }
      ]},
      { d: 0, h: 21, m: 30, table: 'Meja 04', cashier: 'Kasir Shift 2', pay: 'Bon', customer: 'Bang Reza', status: 'BON', items: [
        { name: 'Kopisusu', qty: 2, price: 7000, category: 'hot_drink', subtotal: 14000 },
        { name: 'Gerry', qty: 2, price: 1500, category: 'inventory', subtotal: 3000 }
      ]},
      { d: 0, h: 22, m: 20, table: 'Kasir', cashier: 'Kasir Shift 2', pay: 'Tunai', staff: true, discount: 12500, items: [
        { name: 'Kopi GulaAren', qty: 1, price: 5000, category: 'hot_drink', subtotal: 0, originalPrice: 5000 },
        { name: 'Indomie All varian', qty: 1, price: 6000, category: 'food', subtotal: 0, originalPrice: 6000 },
        { name: 'Gerry', qty: 1, price: 1500, category: 'inventory', subtotal: 0, originalPrice: 1500 }
      ]},

      // H-1 (Kemarin)
      { d: 1, h: 8, m: 20, table: 'Meja 01', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [{ name: 'Kopi tubruk', qty: 2, price: 5000, category: 'hot_drink', subtotal: 10000 }] },
      { d: 1, h: 10, m: 15, table: 'Meja 02', cashier: 'Kasir Shift 1', pay: 'QRIS', items: [{ name: 'Es Teh', qty: 3, price: 5000, category: 'cold_drink', subtotal: 15000 }, { name: 'Risol', qty: 3, price: 3000, category: 'snack', subtotal: 9000 }] },
      { d: 1, h: 12, m: 30, table: 'Meja 03', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [{ name: 'Indomie + telur', qty: 2, price: 9000, category: 'food', subtotal: 18000 }, { name: 'Es Milo', qty: 2, price: 7000, category: 'cold_drink', subtotal: 14000 }] },
      { d: 1, h: 16, m: 45, table: 'Meja 04', cashier: 'Kasir Shift 2', pay: 'QRIS', items: [{ name: 'Kopisusu', qty: 3, price: 7000, category: 'hot_drink', subtotal: 21000 }, { name: 'Gorengan', qty: 5, price: 2000, category: 'snack', subtotal: 10000 }] },
      { d: 1, h: 19, m: 20, table: 'Meja 05', cashier: 'Kasir Shift 2', pay: 'Tunai', items: [{ name: 'Indomie All varian', qty: 3, price: 6000, category: 'food', subtotal: 18000 }, { name: 'Es Teh', qty: 3, price: 5000, category: 'cold_drink', subtotal: 15000 }] },
      { d: 1, h: 21, m: 10, table: 'Meja 02', cashier: 'Kasir Shift 2', pay: 'QRIS', items: [{ name: 'Kopi jahe', qty: 2, price: 5000, category: 'hot_drink', subtotal: 10000 }, { name: 'Sukro', qty: 3, price: 1500, category: 'inventory', subtotal: 4500 }] },

      // H-2
      { d: 2, h: 9, m: 10, table: 'Meja 01', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [{ name: 'Teh panas', qty: 2, price: 4000, category: 'hot_drink', subtotal: 8000 }] },
      { d: 2, h: 13, m: 0, table: 'Meja 03', cashier: 'Kasir Shift 1', pay: 'QRIS', items: [{ name: 'Indomie + telur', qty: 2, price: 9000, category: 'food', subtotal: 18000 }, { name: 'Es GoodDay All Varian', qty: 2, price: 8000, category: 'cold_drink', subtotal: 16000 }] },
      { d: 2, h: 17, m: 30, table: 'Meja 02', cashier: 'Kasir Shift 2', pay: 'Tunai', items: [{ name: 'Es Teh', qty: 4, price: 5000, category: 'cold_drink', subtotal: 20000 }, { name: 'Tahu Sumedang', qty: 4, price: 3000, category: 'snack', subtotal: 12000 }] },
      { d: 2, h: 20, m: 45, table: 'Meja 06', cashier: 'Kasir Shift 2', pay: 'QRIS', items: [{ name: 'Kopisusu', qty: 4, price: 7000, category: 'hot_drink', subtotal: 28000 }, { name: 'Martabak', qty: 3, price: 3000, category: 'snack', subtotal: 9000 }] },

      // H-3
      { d: 3, h: 10, m: 0, table: 'Meja 02', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [{ name: 'Kopi tubruk', qty: 3, price: 5000, category: 'hot_drink', subtotal: 15000 }] },
      { d: 3, h: 14, m: 20, table: 'Meja 04', cashier: 'Kasir Shift 1', pay: 'QRIS', items: [{ name: 'Indomie All varian', qty: 3, price: 6000, category: 'food', subtotal: 18000 }, { name: 'Air mineral Vit', qty: 3, price: 3000, category: 'inventory', subtotal: 9000 }] },
      { d: 3, h: 19, m: 15, table: 'Meja 01', cashier: 'Kasir Shift 2', pay: 'Tunai', items: [{ name: 'Kopisusu', qty: 3, price: 7000, category: 'hot_drink', subtotal: 21000 }, { name: 'Pisang goreng', qty: 4, price: 3000, category: 'snack', subtotal: 12000 }] },

      // H-4
      { d: 4, h: 11, m: 30, table: 'Meja 03', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [{ name: 'Es Teh', qty: 4, price: 5000, category: 'cold_drink', subtotal: 20000 }, { name: 'Risol', qty: 3, price: 3000, category: 'snack', subtotal: 9000 }] },
      { d: 4, h: 18, m: 40, table: 'Meja 02', cashier: 'Kasir Shift 2', pay: 'QRIS', items: [{ name: 'Indomie + telur', qty: 3, price: 9000, category: 'food', subtotal: 27000 }, { name: 'Es Milo', qty: 3, price: 7000, category: 'cold_drink', subtotal: 21000 }] },

      // H-5
      { d: 5, h: 12, m: 15, table: 'Meja 05', cashier: 'Kasir Shift 1', pay: 'QRIS', items: [{ name: 'Kopi Spesial mix', qty: 3, price: 6000, category: 'hot_drink', subtotal: 18000 }, { name: 'Gorengan', qty: 6, price: 2000, category: 'snack', subtotal: 12000 }] },
      { d: 5, h: 20, m: 30, table: 'Meja 01', cashier: 'Kasir Shift 2', pay: 'Tunai', items: [{ name: 'Kopisusu', qty: 4, price: 7000, category: 'hot_drink', subtotal: 28000 }, { name: 'Indomie All varian', qty: 2, price: 6000, category: 'food', subtotal: 12000 }] },

      // H-6
      { d: 6, h: 10, m: 45, table: 'Meja 02', cashier: 'Kasir Shift 1', pay: 'Tunai', items: [{ name: 'Es Teh', qty: 3, price: 5000, category: 'cold_drink', subtotal: 15000 }, { name: 'Malkis', qty: 3, price: 1500, category: 'inventory', subtotal: 4500 }] },
      { d: 6, h: 19, m: 50, table: 'Meja 04', cashier: 'Kasir Shift 2', pay: 'QRIS', items: [{ name: 'Indomie + telur', qty: 2, price: 9000, category: 'food', subtotal: 18000 }, { name: 'Es GoodDay All Varian', qty: 2, price: 8000, category: 'cold_drink', subtotal: 16000 }] }
    ];

    const transactions = txTemplate.map((t, idx) => {
      const iso = makeDate(t.d, t.h, t.m);
      const subtotal = t.items.reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
      const discount = t.discount || 0;
      const total = Math.max(0, subtotal - discount);
      return {
        id: 'TRX-DEMO-' + String(1000 + idx),
        timestamp: iso,
        cashier: t.cashier,
        table: t.table,
        paymentMethod: t.pay,
        customer: t.customer || '',
        status: t.status || 'PAID',
        staff: !!t.staff,
        discount: discount,
        subtotal: subtotal,
        tax: 0,
        total: total,
        paid: t.status === 'BON' ? 0 : total,
        change: 0,
        shift: shiftOf(iso),
        items: t.items
      };
    });

    const expenses = [
      { id: 'EXP-DEMO-1', timestamp: makeDate(0, 8, 10), cashier: 'Kasir Shift 1', category: 'Es Batu', note: 'Es Batu Kristal 2 Bal', amount: 16000, shift: '1' },
      { id: 'EXP-DEMO-2', timestamp: makeDate(0, 14, 0), cashier: 'Kasir Shift 1', category: 'Gas Elpiji', note: 'Isi Gas Elpiji 3kg', amount: 22000, shift: '1' },
      { id: 'EXP-DEMO-3', timestamp: makeDate(1, 9, 30), cashier: 'Kasir Shift 1', category: 'Air Galon', note: 'Air Galon isi ulang 3x', amount: 18000, shift: '1' },
      { id: 'EXP-DEMO-4', timestamp: makeDate(2, 10, 0), cashier: 'Kasir Shift 1', category: 'Bahan Baku', note: 'Belanja Indomie 2 Dus + Telur', amount: 95000, shift: '1' },
      { id: 'EXP-DEMO-5', timestamp: makeDate(4, 15, 30), cashier: 'Kasir Shift 2', category: 'Listrik', note: 'Token Listrik Warkop', amount: 50000, shift: '2' }
    ];

    const todayDateStr = this.businessDateStr(now);
    const cashSessions = {};
    cashSessions[`${todayDateStr}_1`] = {
      id: `${todayDateStr}_1`,
      business_date: todayDateStr,
      shift: '1',
      opened_by: 'Kasir Shift 1',
      modal_awal: 100000,
      open_at: makeDate(0, 6, 30)
    };

    localStorage.setItem(this.storageKeys.transactions, JSON.stringify(transactions));
    localStorage.setItem(this.storageKeys.expenses, JSON.stringify(expenses));
    localStorage.setItem(this.cashStoreKey(), JSON.stringify(cashSessions));
  }

  // --- Supabase Realtime & Remote Database Sync ---
  async initSupabase() {
    if (this.isDemo) return;
    if (!window.supabaseClient) {
      this.isSupabaseReady = false;
      return;
    }
    this.isSupabaseReady = false; // baru true setelah fetch awal sukses

    try {
      // 1. Initial Data Fetch from Supabase
      const [txRes, expRes, menuRes] = await Promise.all([
        window.supabaseClient.from('transactions').select('*').order('timestamp', { ascending: false }),
        window.supabaseClient.from('expenses').select('*').order('timestamp', { ascending: false }),
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

      this.isSupabaseReady = (!txRes.error && !expRes.error);
      this.notifyListeners('dataChanged', this.getAllData());
      
      // Hide loading overlay
      const loader = document.getElementById('app-loading');
      if (loader) loader.style.display = 'none';

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
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, (payload) => {
          const upd = payload.new;
          if (upd && upd.id) {
            const current = this.getTransactions().map(t => t.id === upd.id ? { ...t, ...upd } : t);
            localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));
            this.notifyListeners('dataChanged', this.getAllData());
          }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions' }, (payload) => {
          const deletedId = payload.old && payload.old.id;
          if (deletedId) {
            const current = this.getTransactions().filter(t => t.id !== deletedId);
            localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));
            this.notifyListeners('transactionDeleted', { id: deletedId });
            this.notifyListeners('dataChanged', this.getAllData());
          }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'expenses' }, (payload) => {
          const deletedId = payload.old && payload.old.id;
          if (deletedId) {
            const current = this.getExpenses().filter(e => e.id !== deletedId);
            localStorage.setItem(this.storageKeys.expenses, JSON.stringify(current));
            this.notifyListeners('expenseDeleted', { id: deletedId });
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
    if (this.isDemo) return;
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
        this.socket.on('tx:updated', ({ id, patch }) => {
          const current = this.getTransactions().map(t => t.id !== id ? t : { ...t, ...patch });
          localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));
          this.notifyListeners('dataChanged', this.getAllData());
        });
        this.socket.on('tx:deleted', ({ id }) => {
          const current = this.getTransactions().filter(t => t.id !== id);
          localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));
          this.notifyListeners('transactionDeleted', { id });
          this.notifyListeners('dataChanged', this.getAllData());
        });
        this.socket.on('exp:deleted', ({ id }) => {
          const current = this.getExpenses().filter(e => e.id !== id);
          localStorage.setItem(this.storageKeys.expenses, JSON.stringify(current));
          this.notifyListeners('expenseDeleted', { id });
          this.notifyListeners('dataChanged', this.getAllData());
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
    const existing = this.safeGet(this.storageKeys.menu);
    let menuList = [];
    try {
      menuList = existing ? JSON.parse(existing) : [];
    } catch (e) {
      menuList = [];
    }

    if (!existing || !Array.isArray(menuList) || menuList.length < 30) {
      const defaultMenu = [
        // Inventory
        { id: 'menu-inv-1', name: 'Ice batu Cristal', price: 1000, category: 'inventory', image: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-d-13', name: 'Air mineral Vit', price: 3000, category: 'inventory', image: 'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-7', name: 'Gerry', price: 1500, category: 'inventory', image: 'https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-8', name: 'Malkis', price: 1500, category: 'inventory', image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=400&q=80', is_default: true },
        { id: 'menu-s-9', name: 'Sukro', price: 1500, category: 'inventory', image: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&w=400&q=80', is_default: true },

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
        { id: 'menu-s-6', name: 'Sate Telur puyuh', price: 3000, category: 'snack', image: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=400&q=80', is_default: true }
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
      const data = this.safeGet(this.storageKeys.transactions);
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
      status: txData.status === 'BON' ? 'BON' : 'PAID',
      customer: (txData.customer || '').trim(),
      shift: this.shiftOf(new Date()),
      staff: txData.staff === true,
      discount: Number(txData.discount) || 0
    };

    this.decrementMenuStock(tx.items || []);

    const current = this.getTransactions();
    current.unshift(tx);
    localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));

    if (this.channel) {
      this.channel.postMessage({ type: 'NEW_TRANSACTION', payload: tx });
    }

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('transactions').insert([tx]);
      } catch (err) {
        console.warn('Supabase push tx notice:', err);
      }
    }

    if (this.canSocket()) {
      this.socket.emit('tx:create', tx);
    }

    this.playNotificationSound();
    this.notifyListeners('transactionAdded', tx);
    this.notifyListeners('dataChanged', this.getAllData());
    return tx;
  }

  getExpenses() {
    try {
      const data = this.safeGet(this.storageKeys.expenses);
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
      amount: Number(expData.amount) || 0,
      shift: this.shiftOf(new Date())
    };

    const current = this.getExpenses();
    current.unshift(exp);
    localStorage.setItem(this.storageKeys.expenses, JSON.stringify(current));

    if (this.channel) {
      this.channel.postMessage({ type: 'NEW_EXPENSE', payload: exp });
    }

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('expenses').insert([exp]);
      } catch (err) {
        console.warn('Supabase push expense notice:', err);
      }
    }

    if (this.canSocket()) {
      this.socket.emit('exp:create', exp);
    }

    this.notifyListeners('expenseAdded', exp);
    this.notifyListeners('dataChanged', this.getAllData());
    return exp;
  }

  // --- Menu Management Engine ---
  getMenu() {
    try {
      const data = this.safeGet(this.storageKeys.menu);
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
      is_default: false,
      stock: (item.stock === '' || item.stock == null || isNaN(Number(item.stock)))
        ? null : Math.max(0, parseInt(item.stock, 10))
    };

    const list = this.getMenu();
    list.push(newItem);
    localStorage.setItem(this.storageKeys.menu, JSON.stringify(list));

    if (this.channel) {
      this.channel.postMessage({ type: 'MENU_UPDATED', payload: newItem });
    }

    if (this.canSyncRemote()) {
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

    if (this.canSyncRemote()) {
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

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('menu').delete().eq('id', id);
      } catch (err) {
        console.warn('Supabase delete menu error:', err);
      }
    }

    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true };
  }

  async deleteTransaction(id) {
    if (!id) return { success: false, message: 'ID transaksi tidak valid.' };
    const current = this.getTransactions().filter(t => t.id !== id);
    localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));

    if (this.channel) {
      try { this.channel.postMessage({ type: 'DELETE_TRANSACTION', payload: { id } }); } catch (e) {}
    }

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('transactions').delete().eq('id', id);
      } catch (err) {
        console.warn('Supabase delete tx notice:', err);
      }
    }

    if (this.canSocket()) {
      try { this.socket.emit('tx:delete', { id }); } catch (e) {}
    }
    if (!this.isDemo) {
      try { await fetch(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) {}
    }

    this.notifyListeners('transactionDeleted', { id });
    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true };
  }

  async deleteExpense(id) {
    if (!id) return { success: false, message: 'ID pengeluaran tidak valid.' };
    const current = this.getExpenses().filter(e => e.id !== id);
    localStorage.setItem(this.storageKeys.expenses, JSON.stringify(current));

    if (this.channel) {
      try { this.channel.postMessage({ type: 'DELETE_EXPENSE', payload: { id } }); } catch (e) {}
    }

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('expenses').delete().eq('id', id);
      } catch (err) {
        console.warn('Supabase delete expense notice:', err);
      }
    }

    if (this.canSocket()) {
      try { this.socket.emit('exp:delete', { id }); } catch (e) {}
    }
    if (!this.isDemo) {
      try { await fetch(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) {}
    }

    this.notifyListeners('expenseDeleted', { id });
    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true };
  }

  // --- HARGA KARYAWAN (jatah staff) ---
  // Minuman dingin/panas + makanan = gratis.
  // Snack Rp1.500 = gratis, snack lain turun Rp1.000.
  staffPrice(item) {
    const price = Number(item.price) || 0;
    const cat = item.category || '';
    if (cat === 'cold_drink' || cat === 'hot_drink' || cat === 'food') return 0;
    if (cat === 'snack' || cat === 'inventory') return price <= 1500 ? 0 : price - 1000;
    return price;
  }

  // --- STOK MENU (null = tanpa batas) ---
  async updateMenuItemStock(id, stock) {
    const list = this.getMenu();
    const target = list.find(m => m.id === id);
    if (!target) return { success: false, message: 'Menu tidak ditemukan.' };
    const n = (stock === '' || stock == null || isNaN(Number(stock)))
      ? null : Math.max(0, parseInt(stock, 10));
    target.stock = n;
    localStorage.setItem(this.storageKeys.menu, JSON.stringify(list));

    if (this.channel) {
      try { this.channel.postMessage({ type: 'MENU_UPDATED', payload: target }); } catch (e) {}
    }

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('menu').update({ stock: n }).eq('id', id);
      } catch (err) {
        console.warn('Supabase update stock error:', err);
      }
    }

    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true, stock: n };
  }

  async updateMenuItemPrice(id, price) {
    const list = this.getMenu();
    const target = list.find(m => m.id === id);
    if (!target) return { success: false, message: 'Menu tidak ditemukan.' };
    const n = isNaN(Number(price)) ? null : Math.max(0, Math.round(Number(price)));
    if (n == null) return { success: false, message: 'Harga tidak valid.' };
    target.price = n;
    localStorage.setItem(this.storageKeys.menu, JSON.stringify(list));

    if (this.channel) {
      try { this.channel.postMessage({ type: 'MENU_UPDATED', payload: target }); } catch (e) {}
    }

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('menu').update({ price: n }).eq('id', id);
      } catch (err) {
        console.warn('Supabase update price error:', err);
      }
    }

    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true, price: n };
  }

  decrementMenuStock(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    const list = this.getMenu();
    let changed = false;
    const updates = [];
    items.forEach(it => {
      const m = list.find(x => x.name === it.name);
      if (m && m.stock != null) {
        m.stock = Math.max(0, (Number(m.stock) || 0) - (Number(it.qty) || 1));
        changed = true;
        updates.push({ id: m.id, stock: m.stock });
      }
    });
    if (!changed) return;
    localStorage.setItem(this.storageKeys.menu, JSON.stringify(list));

    if (this.channel) {
      try { this.channel.postMessage({ type: 'MENU_UPDATED', payload: { bulk: true } }); } catch (e) {}
    }

    if (this.canSyncRemote()) {
      updates.forEach(u => {
        window.supabaseClient.from('menu').update({ stock: u.stock }).eq('id', u.id)
          .then(() => {}, () => {});
      });
    }

    this.notifyListeners('dataChanged', this.getAllData());
  }

  getLowStock(threshold = 5) {
    try {
      return this.getMenu().filter(m => m.stock != null && Number(m.stock) <= threshold);
    } catch (e) {
      return [];
    }
  }

  async updateTransaction(id, patch) {
    if (!id || !patch) return { success: false, message: 'Data tidak valid.' };
    const current = this.getTransactions().map(t => t.id !== id ? t : { ...t, ...patch });
    localStorage.setItem(this.storageKeys.transactions, JSON.stringify(current));

    if (this.channel) {
      try { this.channel.postMessage({ type: 'UPDATE_TRANSACTION', payload: { id, patch } }); } catch (e) {}
    }

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('transactions').update(patch).eq('id', id);
      } catch (err) {
        console.warn('Supabase update tx notice:', err);
      }
    }

    if (this.canSocket()) {
      try { this.socket.emit('tx:update', { id, patch }); } catch (e) {}
    } else if (!this.isDemo) {
      try {
        await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        });
      } catch (e) {}
    }

    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true };
  }

  async settleTransaction(id, pay) {
    return this.updateTransaction(id, {
      status: 'PAID',
      paymentMethod: (pay && pay.paymentMethod) || 'Tunai',
      paid: Number((pay && pay.paid)) || 0,
      change: Number((pay && pay.change)) || 0
    });
  }

  // --- OPNAME KAS per tanggal bisnis + shift ---
  cashStoreKey() {
    return this.isDemo ? 'warkop_demo_cash_v2' : 'warkop_cash_v1';
  }

  getCashSessions() {
    try {
      const data = localStorage.getItem(this.cashStoreKey());
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  setCashSessions(obj) {
    localStorage.setItem(this.cashStoreKey(), JSON.stringify(obj || {}));
  }

  async refreshCashSessions() {
    if (this.isDemo) return;
    if (!window.supabaseClient) return;
    try {
      const { data, error } = await window.supabaseClient
        .from('cash_sessions')
        .select('*')
        .order('business_date', { ascending: false })
        .order('shift', { ascending: false })
        .limit(14);
      if (!error && Array.isArray(data)) {
        const obj = {};
        data.forEach(r => { obj[r.id] = r; });
        this.setCashSessions(obj);
        this.notifyListeners('cashChanged', obj);
        this.notifyListeners('dataChanged', this.getAllData());
      }
    } catch (e) {
      console.warn('refresh cash notice:', e);
    }
  }

  async saveCashSession(rec) {
    if (!rec || !rec.id) return { success: false };
    const obj = this.getCashSessions();
    obj[rec.id] = { ...obj[rec.id], ...rec };
    this.setCashSessions(obj);

    if (this.channel) {
      try { this.channel.postMessage({ type: 'CASH_UPDATED', payload: { id: rec.id } }); } catch (e) {}
    }

    if (this.canSyncRemote()) {
      try {
        await window.supabaseClient.from('cash_sessions').upsert([obj[rec.id]], { onConflict: 'id' });
      } catch (err) {
        console.warn('Supabase save cash notice:', err);
      }
    }

    this.notifyListeners('cashChanged', obj);
    this.notifyListeners('dataChanged', this.getAllData());
    return { success: true };
  }

  // Arus kas shift: masuk tunai (lunas) - belanja. QRIS/Bon bukan kas fisik.
  shiftCashFlow(shift, dayStr) {
    const summary = this.getSummary(dayStr || 'today', shift);
    const cashIn = summary.filteredTx
      .filter(t => t.paymentMethod === 'Tunai')
      .reduce((a, t) => a + (Number(t.total) || 0), 0);
    return { cashIn, expenses: summary.totalExpenses };
  }

  getAllData() {
    return {
      transactions: this.getTransactions(),
      expenses: this.getExpenses(),
      menu: this.getMenu(),
      summary: this.getSummary()
    };
  }

  // --- TANGGAL & SHIFT (waktu lokal perangkat, tutup hari 24.00) ---
  // Shift 1: 06.00–15.00, Shift 2: 15.00–24.00. Semua ikut tanggal kalender hari itu.
  businessDateStr(d = new Date()) {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  shiftOf(d = new Date()) {
    const dt = d instanceof Date ? d : new Date(d);
    const h = dt.getHours();
    if (h >= 6 && h < 15) return '1';
    return '2';
  }

  shiftLabel(s) {
    return s === '1' ? 'Shift 1 (06–15)' : 'Shift 2 (15–24)';
  }

  recordShift(r) {
    if (r && r.shift) return r.shift;
    try {
      return this.shiftOf(new Date(r.timestamp));
    } catch (e) {
      return '1';
    }
  }

  recordMatchesDay(r, dayStr) {
    if (!r || !r.timestamp) return false;
    try {
      return this.businessDateStr(new Date(r.timestamp)) === dayStr;
    } catch (e) {
      return false;
    }
  }

  getSummary(dateFilter = 'today', shiftFilter = 'all') {
    const transactions = this.getTransactions();
    const expenses = this.getExpenses();
    const todayStr = this.businessDateStr(new Date());

    const matchShift = (r) => shiftFilter === 'all' || this.recordShift(r) === shiftFilter;

    // dateFilter: 'today' | 'all' | 'YYYY-MM-DD' eksplisit (histori)
    const dayStr = dateFilter === 'today' ? todayStr : (dateFilter === 'all' ? null : dateFilter);

    const filteredTx = transactions.filter((t) => {
      if (dayStr) {
        return this.recordMatchesDay(t, dayStr) && matchShift(t);
      }
      return matchShift(t);
    });

    const filteredExpenses = expenses.filter((e) => {
      if (dayStr) {
        return this.recordMatchesDay(e, dayStr) && matchShift(e);
      }
      return matchShift(e);
    });

    let totalRevenue = 0;
    let totalItemsSold = 0;
    const categoryTotals = {
      inventory: 0,
      cold_drink: 0,
      hot_drink: 0,
      food: 0,
      snack: 0,
      coffee: 0,
      other: 0
    };

    let bonTotal = 0;
    let bonCount = 0;
    filteredTx.forEach((tx) => {
      if (tx.status === 'BON') {
        bonCount += 1;
        bonTotal += (Number(tx.total) || 0);
        return;
      }
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
      bonCount,
      bonTotal,
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

  generateWhatsAppSummary(dateFilter = 'today') {
    const summary = this.getSummary(dateFilter);
    const isHist = dateFilter !== 'today' && dateFilter !== 'all';
    const dateStr = isHist ? this.formatDateIndo(new Date(dateFilter + 'T12:00:00')) : this.formatDateIndo(new Date());

    let msg = `*📊 LAPORAN KASIR WARKOP REAL-TIME*\n`;
    msg += `📅 Tanggal: ${dateStr}\n`;
    msg += `🕒 Update: ${this.formatTime(new Date().toISOString())}\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 *Omzet Penjualan:* ${this.formatRupiah(summary.totalRevenue)}\n`;
    msg += `📉 *Belanja / Pengeluaran:* ${this.formatRupiah(summary.totalExpenses)}\n`;
    msg += `💵 *KAS BERSIH:* ${this.formatRupiah(summary.netProfit)}\n`;
    msg += `🧾 *Total Transaksi:* ${summary.totalOrders} struk (${summary.totalItemsSold} porsi)\n`;
    if (summary.bonCount > 0) {
      msg += `📝 *Bon belum bayar:* ${summary.bonCount} struk (${this.formatRupiah(summary.bonTotal)})\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━\n\n`;

    if (summary.filteredExpenses.length > 0) {
      msg += isHist ? `*Rincian Pengeluaran ${dateStr}:*\n` : `*Rincian Pengeluaran Hari Ini:*\n`;
      summary.filteredExpenses.forEach((e, idx) => {
        msg += `${idx + 1}. ${e.note} (${e.category}) : ${this.formatRupiah(e.amount)}\n`;
      });
      msg += `\n`;
    }

    msg += `_Laporan otomatis dibuat oleh Sistem Kasir Warkop POS._`;
    return encodeURIComponent(msg);
  }

  // Cegah formula injection saat CSV dibuka di Excel
  csvEsc(v) {
    const str = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  }

  exportToCSV(dateFilter = 'all') {
    const summary = this.getSummary(dateFilter);
    const stamp = (dateFilter === 'today' || dateFilter === 'all')
      ? new Date().toISOString().split('T')[0] : dateFilter;
    let csv = 'ID Transaksi,Tanggal,Jam,Kasir,Meja,Metode Bayar,Shift,Rincian Pesanan,Subtotal,Pajak,Total,Status,Staff\n';

    summary.filteredTx.forEach((tx) => {
      const date = tx.timestamp ? new Date(tx.timestamp) : new Date();
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const timeStr = date.toLocaleTimeString('id-ID');
      const itemsDetail = (tx.items || []).map((i) => `${this.csvEsc(i.name)} (${i.qty}x)`).join('; ');

      csv += `"${tx.id}","${dateStr}","${timeStr}","${this.csvEsc(tx.cashier)}","${this.csvEsc(tx.table)}","${this.csvEsc(tx.paymentMethod)}","${this.recordShift(tx) === '1' ? 'Shift 1' : 'Shift 2'}","${this.csvEsc(itemsDetail)}",${tx.subtotal},${tx.tax},${tx.total},"${tx.status}","${tx.staff ? 'Ya' : '-'}","${Number(tx.discount) || 0}"\n`;
    });

    csv += '\n\nID Pengeluaran,Tanggal,Jam,Kasir,Kategori,Shift,Keterangan,Nominal\n';
    summary.filteredExpenses.forEach((exp) => {
      const date = exp.timestamp ? new Date(exp.timestamp) : new Date();
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const timeStr = date.toLocaleTimeString('id-ID');

      csv += `"${exp.id}","${dateStr}","${timeStr}","${this.csvEsc(exp.cashier)}","${this.csvEsc(exp.category)}","${this.recordShift(exp) === '1' ? 'Shift 1' : 'Shift 2'}","${this.csvEsc(exp.note)}",${exp.amount}\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Laporan_Kasir_Warkop_${stamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Global Singleton Instance
window.warkopSync = new WarkopSyncEngine();
