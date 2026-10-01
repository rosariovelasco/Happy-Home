// Acceso a datos. Producción: Supabase. Prueba local (?demo en localhost): db/seed.json en memoria.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=202610011527';

const DEMO = /[?&]demo\b/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
let sb = null, mem = null;

async function client() {
  if (sb) return sb;
  // supabase-js 2.117.2 incluido en el repo (js/vendor) para no depender de un CDN
  if (!window.supabase) await new Promise((ok, err) => { const sc = document.createElement('script'); sc.src = 'js/vendor/supabase.js'; sc.onload = ok; sc.onerror = err; document.head.appendChild(sc); });
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return sb;
}

// ---------- sesión ----------
export async function sesion() {
  if (DEMO) return { user: { id: 'demo', email: 'demo@local' }, perfil: { nombre: new URLSearchParams(location.search).get('como') || 'Rosario', rol: new URLSearchParams(location.search).get('rol') || 'admin' } };
  const c = await client();
  const { data } = await c.auth.getSession();
  if (!data.session) return null;
  const user = data.session.user;
  const { data: p } = await c.from('perfiles').select('*').eq('id', user.id).maybeSingle();
  return { user, perfil: p || { nombre: user.email, rol: 'lector' } };
}
export async function entrar(email, password) {
  const c = await client();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function salir() { if (!DEMO) await (await client()).auth.signOut(); }
export async function cambiarClave(password) {
  const { error } = await (await client()).auth.updateUser({ password });
  if (error) throw error;
}

// ---------- lectura ----------
async function todo(tabla, orden) {
  const c = await client(); const out = []; const paso = 1000;
  for (let i = 0; ; i += paso) {
    let q = c.from(tabla).select('*').range(i, i + paso - 1);
    if (orden) q = q.order(orden, { ascending: true });
    const { data, error } = await q; if (error) throw error;
    out.push(...data); if (data.length < paso) break;
  }
  return out;
}
export async function cargar() {
  if (DEMO) {
    if (!mem) { const r = await fetch('db/seed.json'); mem = await r.json(); mem.cotizaciones ||= []; mem.movimientos.forEach(m => m.anulado ||= false); }
    return structuredClone(mem);
  }
  const [obras, movimientos, saldos_banco, banco_lineas, cotizaciones] = await Promise.all([
    todo('obras', 'id'), todo('movimientos', 'id'), todo('saldos_banco', 'id'), todo('banco_lineas', 'id'), todo('cotizaciones', 'id')]);
  return { obras, movimientos, saldos_banco, banco_lineas, cotizaciones };
}
export async function historial(movId) {
  if (DEMO) return [];
  const { data, error } = await (await client()).from('movimientos_historial').select('*').eq('mov_id', movId).order('cuando', { ascending: false });
  if (error) throw error; return data;
}

// ---------- escritura ----------
let demoN = 900;
const nuevoId = (pref) => `${pref}-${new Date().getFullYear()}-${String(demoN++).padStart(4, '0')}`;
export async function insertar(tabla, filas) {
  filas = [].concat(filas);
  if (DEMO) {
    const L = mem[tabla] ||= [];
    const out = filas.map(f => ({ ...f, id: f.id || (tabla === 'movimientos' ? nuevoId('MOV') : tabla === 'obras' ? nuevoId('HH') : demoN++), anulado: f.anulado || false }));
    L.push(...out); return out;
  }
  const { data, error } = await (await client()).from(tabla).insert(filas).select();
  if (error) throw error; return data;
}
export async function actualizar(tabla, id, cambios) {
  if (DEMO) { const f = mem[tabla].find(x => x.id === id); Object.assign(f, cambios); return f; }
  const { data, error } = await (await client()).from(tabla).update(cambios).eq('id', id).select();
  if (error) throw error; return data[0];
}
export const esDemo = DEMO;
