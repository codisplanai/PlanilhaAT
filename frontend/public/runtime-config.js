// Em Docker, /runtime-config.js é sobrescrito dinamicamente pelo FastAPI.
// Em Vercel, este arquivo evita 404 e permite os fallbacks VITE_* do bundle.
window.__PLANAUT_CONFIG__ = window.__PLANAUT_CONFIG__ || {};
