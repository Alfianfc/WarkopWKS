// Supabase Client Singleton
const SUPABASE_URL = 'https://nhurdxqktksqzepxgkrj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5odXJkeHFrdGtzcXplcHhna3JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NjU5NzksImV4cCI6MjEwMzM0MTk3OX0.adXRwhZIxU_WS0RXx827MZNceJGwEZe9-5APl2coXtc';

window.supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
