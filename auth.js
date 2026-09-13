/**
 * Warkop Authentication & Role Guard Engine (Supabase + Local Fallback)
 * Mengelola autentikasi login Username & Password untuk Kasir dan Bos (Owner)
 */

class WarkopAuth {
  constructor() {
    this.storageKey = 'warkop_auth_accounts_v2'; // v2: reset pasca-rotasi password Sep 2026
    this.sessionKey = 'warkop_current_session_v2'; // v2: paksa login ulang pasca-rotasi
    this.initDefaultAccounts();
    this.syncFromSupabase();
  }

  initDefaultAccounts() {
    // Username boleh di-seed lokal; password TIDAK PERNAH disimpan di repo.
    // Password terisi saat login sukses via RPC dan tersimpan per-perangkat.
    if (!localStorage.getItem(this.storageKey)) {
      const defaultAccounts = {
        kasir: {
          username: 'kasir',
          password: '',
          role: 'kasir',
          name: 'Kasir Warkop'
        },
        bos: {
          username: 'bos',
          password: '',
          role: 'bos',
          name: 'Owner / Bos'
        }
      };
      localStorage.setItem(this.storageKey, JSON.stringify(defaultAccounts));
    }
  }

  async syncFromSupabase() {
    if (!window.supabaseClient) return;
    try {
      const { data, error } = await window.supabaseClient.rpc('pos_list_users');
      if (!error && Array.isArray(data) && data.length > 0) {
        const accounts = {};
        data.forEach(u => {
          const prev = (accounts[u.role] || {});
          accounts[u.role] = {
            username: u.username,
            password: prev.password || '',
            role: u.role,
            name: u.name
          };
        });
        const cached = this.getAccounts();
        Object.keys(accounts).forEach(k => {
          if (cached[k] && cached[k].password) accounts[k].password = cached[k].password;
        });
        this.saveAccounts(accounts);
      }
    } catch (e) {
      console.warn('Sync users from Supabase notice:', e);
    }
  }

  getAccounts() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  saveAccounts(accounts) {
    localStorage.setItem(this.storageKey, JSON.stringify(accounts));
  }

  async login(username, password) {
    const cleanUser = (username || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();

    if (window.supabaseClient) {
      try {
        const { data, error } = await window.supabaseClient
          .rpc('pos_login', { p_username: cleanUser, p_password: cleanPass });

        if (!error) {
          if (data && data.length > 0) {
            const acc = data[0];
            const sessionData = {
              username: acc.username,
              role: acc.role,
              name: acc.name,
              loginAt: new Date().toISOString()
            };
            sessionStorage.setItem(this.sessionKey, JSON.stringify(sessionData));
            localStorage.setItem(this.sessionKey, JSON.stringify(sessionData));
            // Seed password ke cache lokal biar fallback offline jalan di perangkat ini
            try {
              const cached = this.getAccounts();
              const key = (acc.role || '').toLowerCase() === 'bos' ? 'bos' : 'kasir';
              cached[key] = { username: acc.username, password: cleanPass, role: acc.role, name: acc.name };
              this.saveAccounts(cached);
            } catch (e) {}
            return { success: true, user: sessionData };
          }
          return {
            success: false,
            message: 'Username atau Password salah! Periksa kembali huruf besar/kecil.'
          };
        }
      } catch (e) {
        console.warn('Supabase login check fallback to local:', e);
      }
    }

    const accounts = this.getAccounts();
    for (const key in accounts) {
      const acc = accounts[key];
      if (!acc.password) continue; // akun belum pernah login sukses di perangkat ini
      if (acc.username.toLowerCase() === cleanUser && acc.password === cleanPass) {
        const sessionData = {
          username: acc.username,
          role: acc.role,
          name: acc.name,
          loginAt: new Date().toISOString()
        };
        sessionStorage.setItem(this.sessionKey, JSON.stringify(sessionData));
        localStorage.setItem(this.sessionKey, JSON.stringify(sessionData));
        return { success: true, user: sessionData };
      }
    }

    return {
      success: false,
      message: 'Username atau Password salah! Periksa kembali huruf besar/kecil.'
    };
  }

  getCurrentUser() {
    try {
      const session = sessionStorage.getItem(this.sessionKey) || localStorage.getItem(this.sessionKey);
      return session ? JSON.parse(session) : null;
    } catch (e) {
      return null;
    }
  }

  isLoggedIn() {
    return this.getCurrentUser() !== null;
  }

  logout(redirectUrl = '/') {
    sessionStorage.removeItem(this.sessionKey);
    localStorage.removeItem(this.sessionKey);
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
  }

  requireAuth(requiredRole = null, fallbackUrl = '/') {
    const user = this.getCurrentUser();
    if (!user) {
      window.location.href = fallbackUrl;
      return false;
    }

    if (requiredRole === 'kasir' && (user.role === 'kasir' || user.role === 'bos')) {
      return true;
    }

    if (requiredRole === 'bos' && user.role !== 'bos') {
      alert('⛔ Akses Ditolak: Halaman Laporan Finansial hanya dapat diakses oleh Bos / Pemilik Warkop.');
      window.location.href = '/kasir';
      return false;
    }

    return true;
  }

  async updateCredentials(targetRole, newUsername, newPassword) {
    if (!newUsername || !newPassword || newPassword.length < 4) {
      return { success: false, message: 'Password minimal 4 karakter.' };
    }

    const cleanUser = newUsername.trim();
    const cleanPass = newPassword.trim();

    const cachedAcc = this.getAccounts();
    const currentPass = (cachedAcc[targetRole] && cachedAcc[targetRole].password) || '';
    if (window.supabaseClient && currentPass) {
      try {
        const { data, error } = await window.supabaseClient
          .rpc('pos_set_credentials', { p_role: targetRole, p_current_password: currentPass, p_new_username: cleanUser, p_new_password: cleanPass });
        if (error || !data) {
          return { success: false, message: 'Gagal verifikasi sesi. Login ulang lalu coba lagi.' };
        }
      } catch (e) {
        console.warn('Update user in Supabase failed:', e);
      }
    }

    const accounts = this.getAccounts();
    if (accounts[targetRole]) {
      accounts[targetRole].username = cleanUser;
      accounts[targetRole].password = cleanPass;
      this.saveAccounts(accounts);
    }

    const currentUser = this.getCurrentUser();
    if (currentUser && currentUser.role === targetRole) {
      currentUser.username = cleanUser;
      sessionStorage.setItem(this.sessionKey, JSON.stringify(currentUser));
      localStorage.setItem(this.sessionKey, JSON.stringify(currentUser));
    }

    return { success: true, message: 'Kredensial berhasil diperbarui!' };
  }
}

window.warkopAuth = new WarkopAuth();
