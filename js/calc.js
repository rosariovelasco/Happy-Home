// Cálculos: margen por obra, resultado mensual y caja.
// Todo se calcula desde los movimientos; nada se guarda calculado.

export const NO_BANCO = ['TC de la casa', 'Cuenta personal socio', 'Pagado en el F29'];
export const DESDE = '2026-01-01'; // inicio de los datos limpios (cuadrados con el banco)

const r0 = v => Math.round(v || 0);
// Fecha de la factura: define el mes del IVA. Si el dato no existe (datos antiguos/demo) se usa la fecha del movimiento.
// Sin fecha de factura: un ingreso cuya factura aún no se envía no cuenta (su IVA entra cuando se marque enviada); todo lo demás usa la fecha del movimiento.
export const fechaDoc = m => m.fecha_doc || ((m.tipo === 'ingreso' && ['falta', 'por_emitir'].includes(m.estado_doc)) ? '' : (m.fecha || ''));
export const ivaDebito = m => m.tipo === 'ingreso' && (m.nat === 'Venta' || (m.nat === 'Recupero' && m.cuenta === 'Reembolso de cliente'));
export const ivaCredito = m => m.tipo === 'egreso' && ['Costo directo', 'Estructura', 'Financiero'].includes(m.nat);

// ---------- constructora del proyecto y condición acordada ----------
// Los proyectos antiguos quedaron guardados como Casa Construcción, 50% del margen (la regla de siempre). Desde Rododenros se elige en cada proyecto.
// Sin constructora o sin condición: la app no le calcula participación y avisa.
export const CONSTRUCTORAS = ['Casa Construcción', 'José Donoso'];
export const COND_TIPOS = { margen: '% del margen', venta: '% de la venta neta', fijo: 'Monto fijo (neto, sin IVA)' };
export function condCons(o) {
  if (!o || o.un !== 'Construcción') return null;
  if (!o.constructora) return { nombre: 'Sin constructora', tipo: null, valor: null, ok: false, sin: true };
  const tipo = COND_TIPOS[o.cond_tipo] ? o.cond_tipo : null;
  const valor = (o.cond_valor === null || o.cond_valor === undefined || o.cond_valor === '') ? null : +o.cond_valor;
  return { nombre: o.constructora, tipo, valor, ok: !!tipo && valor !== null && !isNaN(valor) };
}
// Parte de la constructora (neto) sobre un margen y una venta. frac = qué fracción del presupuesto representa esa venta (solo para monto fijo).
export function parteCons(c, margen, venta, frac) {
  if (!c || !c.ok) return 0;
  if (c.tipo === 'margen') return margen * c.valor / 100;
  if (c.tipo === 'venta') return venta * c.valor / 100;
  return c.valor * Math.max(0, Math.min(1, frac));
}

export function calcObras(obrasDB, movs) {
  const by = {};
  for (const m of movs) if (m.obra_id && !m.anulado) (by[m.obra_id] ||= []).push(m);
  const out = [];
  for (const o of obrasDB) {
    const L = by[o.id] || [];
    let cobrado_neto = 0, cobrado_total = 0, costo = 0, recupero = 0, perdida = 0, part_cc = 0, part_cc_total = 0, por_cobrar_mov = 0, por_pagar = 0, ult = null, costo_bruto = 0, recupero_bruto = 0;
    const cuentas = {};
    for (const m of L) {
      const neto = +m.neto || 0;
      if (m.fecha && (!ult || m.fecha > ult)) ult = m.fecha;
      if (!m.pagado) {
        if (m.nat === 'Venta') por_cobrar_mov += +m.total;
        else if (m.nat === 'Costo directo') { por_pagar += +m.total; costo += neto; costo_bruto += +m.total; cuentas[m.cuenta] = (cuentas[m.cuenta] || 0) + neto; }
        else if (m.nat === 'Pérdida' && m.tipo === 'ingreso') perdida += neto;
        continue;
      }
      if (m.nat === 'Venta') { cobrado_neto += neto; cobrado_total += +m.total; }
      else if (m.nat === 'Costo directo') {
        if (m.cuenta === 'Participación CC') { part_cc += neto; part_cc_total += +m.total; }
        else { costo += neto; costo_bruto += +m.total; cuentas[m.cuenta] = (cuentas[m.cuenta] || 0) + neto; }
      } else if (m.nat === 'Recupero') { recupero += neto; recupero_bruto += +m.total; cuentas['(−) Reembolsos y devoluciones'] = (cuentas['(−) Reembolsos y devoluciones'] || 0) - neto; }
      else if (m.nat === 'Pérdida') perdida += neto;
    }
    const abierta = o.estado === 'en_curso';
    const costoN = costo - recupero;
    let base_ing, costo_final, margen;
    if (abierta) {
      base_ing = +o.pres_neto;
      const proy = +o.costo_proy || 0;
      costo_final = proy ? Math.max(proy, costoN) : (+o.costo_est ? Math.max(+o.costo_est, costoN) : costoN);
      margen = base_ing - costo_final - perdida;
    } else {
      base_ing = cobrado_neto + Math.round(por_cobrar_mov / 1.19);
      margen = base_ing - costoN;
      costo_final = costoN;
    }
    const cons = condCons(o);
    const cc = cons ? Math.round(parteCons(cons, margen, base_ing, 1)) : 0;
    out.push({
      ...o, cons, id: o.id, nombre: o.nombre, un: o.un, cliente: o.cliente, abierta, inicio: o.inicio, ult,
      pres_neto: r0(o.pres_neto), pres_total: r0(o.pres_total), costo_est: r0(o.costo_est),
      cobrado_neto: r0(cobrado_neto), cobrado_total: r0(cobrado_total),
      por_cobrar: abierta ? r0(Math.max(0, o.pres_total - cobrado_total)) : r0(por_cobrar_mov),
      costo_real: r0(costoN), costo_final: r0(costo_final), perdida: r0(perdida), margen: r0(margen),
      margen_pres: +o.costo_est && +o.pres_neto ? r0(o.pres_neto - o.costo_est) : null,
      margen_pres_pct: +o.costo_est && +o.pres_neto ? Math.round((o.pres_neto - o.costo_est) / o.pres_neto * 1000) / 10 : null,
      costo_proy: +o.costo_proy || null,
      margen_pct: base_ing ? Math.round(margen / base_ing * 1000) / 10 : 0,
      cc_parte: cc, cc_pagado: r0(part_cc), cc_pagado_total: r0(part_cc_total), costo_con_iva: r0(costo_bruto - recupero_bruto), margen_hh: r0(margen - cc), por_pagar: r0(por_pagar),
      cuentas: Object.fromEntries(Object.entries(cuentas).map(([k, v]) => [k, r0(v)]).sort((a, b) => b[1] - a[1])),
      n_movs: L.length, avance_gasto: +o.costo_est ? Math.round(costoN / o.costo_est * 1000) / 10 : null,
      descuadre: abierta ? 0 : r0(o.pres_neto - base_ing - perdida),
      reciente: abierta || (ult || '') >= DESDE,
    });
  }
  out.sort((a, b) => (a.abierta === b.abierta ? (b.pres_neto || 0) - (a.pres_neto || 0) : a.abierta ? -1 : 1));
  return out;
}

export function mesesHasta(hoy) {
  const out = []; let [y, m] = DESDE.slice(0, 7).split('-').map(Number);
  const [hy, hm] = hoy.slice(0, 7).split('-').map(Number);
  while (y < hy || (y === hy && m <= hm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export function calcResultado(movs, meses) {
  const R = {};
  for (const mm of meses) R[mm] = { ventas: {}, directo: {}, estructura: {}, financiero: 0, noafecta: {} };
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  for (const m of movs) {
    if (m.anulado || !m.pagado || !m.fecha) continue;
    const r = R[m.fecha.slice(0, 7)]; if (!r) continue;
    const neto = +m.neto || 0, un = m.un || 'Sin unidad';
    if (m.nat === 'Venta') add(r.ventas, un, neto);
    else if (m.nat === 'Costo directo') add(r.directo, un, neto);
    else if (m.nat === 'Recupero') add(r.directo, un, -neto);
    else if (m.nat === 'Pérdida') add(r.directo, un, neto);
    else if (m.nat === 'Estructura') add(r.estructura, m.cuenta, neto);
    else if (m.nat === 'Financiero') r.financiero += neto;
    else if (m.nat === 'No afecta') add(r.noafecta, m.cuenta, m.tipo === 'egreso' ? +m.total : -m.total);
  }
  return R;
}

export function calcCaja(movs, saldos, obras, R, meses, hoy) {
  // saldo según la última cartola de cada cuenta + lo pagado/cobrado después (solo lo que pasa por el banco)
  const ult = {};
  for (const s of saldos) if (!ult[s.cuenta] || s.fecha > ult[s.cuenta].fecha) ult[s.cuenta] = s;
  const cuentas = Object.values(ult).map(s => ({ nombre: s.cuenta === 'Reserva F29' ? 'Reserva F29 (cuenta Rosario)' : 'Cuenta corriente ' + s.cuenta, saldo: +s.saldo, fecha: s.fecha }));
  const fechaCorte = Object.values(ult).reduce((a, s) => (!a || s.fecha < a ? s.fecha : a), null);
  const despues = movs.filter(m => !m.anulado && m.pagado && m.fecha && fechaCorte && m.fecha > fechaCorte && !NO_BANCO.includes(m.medio) && m.cuenta !== 'Traspaso entre cuentas');
  const movDesde = despues.reduce((a, m) => a + (m.tipo === 'ingreso' ? +m.total : -m.total), 0);
  // IVA del mes anterior (se paga en el F29 de este mes) menos lo ya pagado este mes
  const mesAct = hoy.slice(0, 7);
  const d = new Date(hoy + 'T12:00:00'); d.setMonth(d.getMonth() - 1);
  const mesAnt = d.toISOString().slice(0, 7);
  const enMes = (m, mm) => (m.fecha || '').startsWith(mm) && !m.anulado;
  // IVA: se declara en el mes de la factura (fecha_doc), no cuando se paga
  const enMesDoc = (m, mm) => fechaDoc(m).startsWith(mm) && !m.anulado;
  const iva_debito = movs.filter(m => enMesDoc(m, mesAnt) && ivaDebito(m)).reduce((a, m) => a + (+m.iva || 0), 0);
  const iva_credito = movs.filter(m => enMesDoc(m, mesAnt) && ivaCredito(m)).reduce((a, m) => a + (+m.iva || 0), 0);
  const f29_pagado = movs.filter(m => enMes(m, mesAct) && m.cuenta === 'Pago F29 (IVA)' && m.pagado).reduce((a, m) => a + (+m.total || 0), 0);
  const obraN = id => (obras.find(o => o.id === id) || {}).nombre || 'General';
  const pend_pagos = movs.filter(m => !m.anulado && m.tipo === 'egreso' && !m.pagado && m.nat !== 'Pérdida')
    .map(m => ({ id: m.id, fecha: m.fecha, quien: m.quien, total: r0(m.total), detalle: m.detalle, obra: obraN(m.obra_id) }));
  const pend_cobros = movs.filter(m => !m.anulado && m.tipo === 'ingreso' && !m.pagado && ['Venta', 'Recupero'].includes(m.nat))
    .map(m => ({ id: m.id, fecha: m.fecha, quien: m.quien, total: r0(m.total), tipo: m.cuenta, obra: obraN(m.obra_id) }));
  // colchón: promedio de estructura + financiero de los últimos 6 meses completos
  const completos = meses.filter(mm => mm < mesAct).slice(-6);
  const estr = completos.map(mm => Object.values(R[mm].estructura).reduce((a, b) => a + b, 0) + R[mm].financiero);
  const estructura_prom = estr.length ? r0(estr.reduce((a, b) => a + b, 0) / estr.length) : 0;
  return { cuentas, fechaCorte, movDesde: r0(movDesde), nDesde: despues.length, mesAnt, iva_debito: r0(iva_debito), iva_credito: r0(iva_credito), f29_pagado: r0(f29_pagado), estructura_prom, pend_pagos, pend_cobros };
}

export function catalogoProveedores(movs) {
  const cat = {};
  for (const m of movs) {
    if (m.tipo !== 'egreso' || !m.quien || m.anulado) continue;
    const k = m.quien.trim().toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
    const c = (cat[k] ||= {});
    const key = m.nat + '|' + m.cuenta; c[key] = (c[key] || 0) + 1;
  }
  const out = {};
  for (const [k, c] of Object.entries(cat)) {
    const tot = Object.values(c).reduce((a, b) => a + b, 0); if (tot < 2) continue;
    const [nat, cuenta] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0].split('|');
    out[k] = { nat, cuenta, n: tot };
  }
  return out;
}
