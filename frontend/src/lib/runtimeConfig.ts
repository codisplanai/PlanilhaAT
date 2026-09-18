export type RuntimeConfig = {
  apiUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  appVersion?: string;
};

declare global {
  interface Window {
    __PLANAUT_CONFIG__?: RuntimeConfig;
  }
}

export const runtimeConfig: RuntimeConfig = window.__PLANAUT_CONFIG__ ?? {};
