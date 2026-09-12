/**
 * Warkop Authentication & Role Guard Engine (Supabase + Local Fallback)
 * Mengelola autentikasi login Username & Password untuk Kasir dan Bos (Owner)
 */

class WarkopAuth {
  constructor() {
    this.storageKey = 'warkop_auth_accounts_v1';
    this.sessionKey = 'warkop_current_session_v1';
    this.initDefaultAccounts();
    this.syncFromSupabase();
  }

  initDefaultAccounts() {
    if (!localStorage.getItem(this.storageKey)) {
      const defaultAccounts = {
        kasir: {
          username: 'alfian',
          password: 'wks-3a61f6',
          role: 'kasir',
          name: 'Kasir Warkop'
        },
        bos: {
          username: 'Bu Ulfa',
          password: 'wks-dd61f6',
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
      const { data, error } = await window.supabaseClient.from('users').select('*');
      if (!error && Array.isArray(data) && data.length > 0) {
        const accounts = {};
        data.forEach(u => {
          accounts[u.role] = {
            username: u.username,
            password: u.password,
            role: u.role,
            name: u.name
          };
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
          .from('users')
          .select('*')
          .ilike('username', cleanUser)
          .eq('password', cleanPass)
          .limit(1);

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

    if (window.supabaseClient) {
      try {
        await window.supabaseClient
          .from('users')
          .update({ username: cleanUser, password: cleanPass })
          .eq('role', targetRole);
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
