import { createClient } from '@supabase/supabase-js';
import { runtimeConfig } from './runtimeConfig';

const supabaseUrl = runtimeConfig.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = runtimeConfig.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
