// Supabase Client Singleton
const SUPABASE_URL = 'https://nhurdxqktksqzepxgkrj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xYBbuLrTGRLh57DNpNtkdQ_qZVf0gFK';

window.supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
