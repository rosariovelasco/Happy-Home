import * as api from './api.js?v=202610011540';
import { calcObras, calcResultado, calcCaja, catalogoProveedores, mesesHasta, NO_BANCO } from './calc.js?v=202610011540';
const HOY=(()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)})();
let DB=null, ME=null;
const D={movs:[],obras:[],resultado:{},meses:[],caja:{},proveedores:{},banco:[]};
const $=s=>document.querySelector(s);
const clp=v=>(v<0?'−':'')+'$'+Math.abs(Math.round(v||0)).toLocaleString('es-CL');
const mill=v=>(v<0?'−':'')+'$'+(Math.abs(v)/1e6).toLocaleString('es-CL',{maximumFractionDigits:1})+'M';
const pct=v=>(Math.round(v*10)/10).toLocaleString('es-CL')+'%';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const MESL=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fdate=s=>s?`${s.slice(8,10)}-${MES[+s.slice(5,7)-1]}`:'sin fecha';
const sum=a=>a.reduce((x,y)=>x+y,0);
const vals=o=>Object.values(o||{});
const NATL=n=>n==='Estructura'?'Gastos generales':n;
const EDOC=(m)=>({ok:m.tipo==='ingreso'?'Factura enviada':'Doc. recibido',falta:m.tipo==='ingreso'?'Falta enviar factura':'Falta factura',por_emitir:'Hacer boleta',no_aplica:'No aplica'})[m.estado_doc||'no_aplica'];
const edocChip=m=>m.estado_doc==='falta'?` <span class="chip warn">${EDOC(m)}</span>`:m.estado_doc==='por_emitir'?' <span class="chip warn">Hacer boleta</span>':'';

/* ---------- cálculos compartidos ---------- */
let obras=[], obrasAll=[];
const noCuadrada=o=>!o.abierta && Math.abs(o.descuadre)>Math.max(20000,o.pres_neto*0.01);
function ccPendiente(o){
  if(o.un!=='Construcción'||noCuadrada(o)||o.margen<=0) return 0;
  const share = o.abierta ? o.cc_parte*(o.pres_neto? o.cobrado_neto/o.pres_neto:0) : o.cc_parte;
  return Math.max(0,Math.round(share-o.cc_pagado));
}
// plata real: lo que hay que transferir a CC (CC factura su participación: +19% IVA, que HH recupera en el F29)
const ccPlata=o=>Math.round(ccPendiente(o)*1.19);
let R={}, meses=[];
function mesTot(m){const r=R[m];const v=sum(vals(r.ventas)),d=sum(vals(r.directo)),e=sum(vals(r.estructura));return {v,d,mc:v-d,e,f:r.financiero,res:v-d-e-r.financiero}}
let tot, C, cajaTotal, ivaPagar;
let pagosPend,ccPend,colchon,libre,porCobrarObras,cobrosExtra,porCobrar;
function recalc(){
  pagosPend=sum(C.pend_pagos.map(p=>p.total));
  ccPend=sum(obras.map(ccPlata));
  colchon=C.estructura_prom;
  libre=cajaTotal-ivaPagar-pagosPend-ccPend-colchon;
  porCobrarObras=obras.filter(o=>o.abierta).map(o=>({o,monto:o.por_cobrar})).filter(x=>x.monto>0);
  // un cobro pendiente a cliente de una obra en curso ya está dentro del saldo del presupuesto: no se suma dos veces
  const obrasPC=new Set(porCobrarObras.map(x=>x.o.nombre));
  cobrosExtra=C.pend_cobros.filter(p=>!(p.tipo==='Cobro a cliente'&&obrasPC.has(p.obra)));
  porCobrar=sum(porCobrarObras.map(x=>x.monto))+sum(cobrosExtra.map(p=>p.total));
}

function rebuild(){
  const oN={}; DB.obras.forEach(o=>oN[o.id]=o.nombre);
  const movs=DB.movimientos.filter(m=>!m.anulado);
  D.movs=movs.map(m=>({...m,total:+m.total,neto:+m.neto,iva:+m.iva,obra_n:m.obra_id?(oN[m.obra_id]||m.obra_id):'General HH',adj:!!m.adjunto})).sort((a,b)=>(b.fecha||'9999').localeCompare(a.fecha||'9999')||b.id.localeCompare(a.id));
  obrasAll=calcObras(DB.obras,movs); obras=obrasAll.filter(o=>o.reciente); D.obras=obras;
  meses=mesesHasta(HOY); R=calcResultado(movs,meses); D.meses=meses; D.resultado=R;
  tot=meses.map(mesTot).reduce((a,b)=>({v:a.v+b.v,d:a.d+b.d,mc:a.mc+b.mc,e:a.e+b.e,f:a.f+b.f,res:a.res+b.res}),{v:0,d:0,mc:0,e:0,f:0,res:0});
  C=calcCaja(movs,DB.saldos_banco,obrasAll,R,meses,HOY); D.caja=C;
  C.fecha=C.fechaCorte?fdate(C.fechaCorte)+' '+C.fechaCorte.slice(0,4):'—';
  cajaTotal=sum(C.cuentas.map(c=>c.saldo))+C.movDesde;
  ivaPagar=Math.max(0,C.iva_debito-C.iva_credito-C.f29_pagado);
  D.proveedores=catalogoProveedores(movs);
  D.banco=(DB.banco_lineas||[]).map(b=>({...b,monto:+b.monto,desc:b.descripcion,cuenta:b.cuenta.slice(-4).replace('-',''),movs:b.movs||[]})).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  COT.length=0; (DB.cotizaciones||[]).slice().reverse().forEach(c=>COT.push({...c,q:c.cantidad,u:c.unidad,p:c.partidas||{},mg:+c.margen,neto:+c.neto,iva:+c.iva}));
  recalc();
  porCobrarObras.forEach(x=>{if(!plan[x.o.id]) plan[x.o.id]={monto:x.monto,sem:99}; else plan[x.o.id].monto=x.monto;});
  if(!meses.includes(repM)) repM=meses[meses.length-1];
}
async function reload(v){
  DB=await api.cargar(); rebuild(); show(v||cur);
}


/* ---------- desglose de plata libre y por cobrar ---------- */
function ccExplica(o){
  const pc=o.pres_neto? o.cobrado_neto/o.pres_neto:0;
  const ganado=Math.round((o.abierta?o.cc_parte*pc:o.cc_parte)*1.19);
  return `${o.abierta?'Le corresponde por lo que ya pagó el cliente ('+pct(pc*100)+')':'Le corresponde'}: ${clp(ganado)} con IVA${o.cc_pagado_total?` − ya transferido ${clp(o.cc_pagado_total)}`:''} = ${clp(ccPlata(o))}. De eso, ${clp(ccPlata(o)-ccPendiente(o))} es IVA de su factura, que HH recupera en el F29.`;
}
function desgloseLibre(){
  const ccObras=obras.filter(o=>ccPendiente(o)>0);
  const sec=(t,m,body)=>`<tr class="tot"><td>${t}</td><td class="n">${clp(m)}</td></tr>${body||''}`;
  const sub=(a,b,m,id)=>`<tr${id?` data-mov="${id}"`:''}><td style="padding-left:18px">${a}${b?`<br><small>${b}</small>`:''}</td><td class="n"><small>${clp(m)}</small></td></tr>`;
  return `<div class="tbl"><table><tbody>
   ${sec('Plata en el banco',cajaTotal, C.cuentas.map(c=>sub(esc(c.nombre),'según cartola al '+fdate(c.fecha),c.saldo)).join('')+(C.nDesde?sub('Pagos y cobros registrados después de la cartola',C.nDesde+' movimientos',C.movDesde):''))}
   ${sec('− Pagos pendientes a proveedores',-pagosPend, C.pend_pagos.map(p=>sub(`<b>${esc(p.quien)}</b> · ${esc(p.obra)}`,`${esc(p.detalle||'')} · ${p.fecha?'registrado '+fdate(p.fecha):'<span class="negc">sin fecha</span>'} · ${p.id}`,-p.total,p.id)).join(''))}
   ${sec('− Participación Casa Construcción por transferir (estimada, con IVA)',-ccPend, ccObras.map(o=>sub(`<b>${esc(o.nombre)}</b>`,ccExplica(o),-ccPlata(o))).join(''))}
   ${sec('− IVA por pagar en el F29 de este mes',-ivaPagar, sub('IVA débito '+MESL[+C.mesAnt.slice(5)-1]+' (ventas)','',C.iva_debito)+sub('IVA crédito '+MESL[+C.mesAnt.slice(5)-1]+' (compras)',C.iva_debito-C.iva_credito<0?'más crédito que débito: el F29 sale en cero y queda remanente a favor':'',-C.iva_credito)+(C.f29_pagado?sub('F29 ya pagado este mes','',C.f29_pagado):''))}
   ${sec('− Colchón: 1 mes de gastos fijos',-colchon, sub('Promedio mensual de gastos generales (últimos 6 meses)','contador, Previred, Entel, TAG, seguros, etc. Se guarda para no quedar sin pagar el mes',-colchon))}
   <tr class="tot"><td>= Plata libre</td><td class="n ${libre>=0?'pos':'negc'}">${clp(libre)}</td></tr>
  </tbody></table></div>
  <p class="help">${libre<0?'Los compromisos son mayores que la plata en el banco. No es que falte plata hoy para pagar: es que no hay plata «de libre disposición» para retiros hasta que entren los próximos cobros.':'Es la plata que se puede retirar sin comprometer obras, impuestos ni gastos fijos.'} La participación de Casa Construcción en obras en curso se estima en proporción a lo que ya pagó el cliente.</p>`;
}
function desgloseCobrar(){
  return `<div class="tbl"><table><tbody>
   ${porCobrarObras.map(x=>`<tr data-obra="${x.o.id}" style="cursor:pointer"><td><b>${esc(x.o.nombre)}</b><br><small>presupuesto ${clp(x.o.pres_total)} − pagado por el cliente ${clp(x.o.cobrado_total)} (con IVA)</small></td><td class="n">${clp(x.monto)}</td></tr>`).join('')}
   ${cobrosExtra.map(p=>`<tr><td><b>${esc(p.quien)}</b> · ${esc(p.tipo)}<br><small>${esc(p.obra)} · ${fdate(p.fecha)} · ${p.id}</small></td><td class="n">${clp(p.total)}</td></tr>`).join('')}
   <tr class="tot"><td>Total por cobrar</td><td class="n">${clp(porCobrar)}</td></tr>
  </tbody></table></div><p class="help">Toca una obra para ver su ficha.</p>`;
}
function abrir(t,html){$('#dlgT').innerHTML=`<h2 style="margin:0">${t}</h2>`;$('#dlgB').innerHTML=html;$('#dlg').showModal();}
/* ---------- vistas ---------- */
const V={};
V.inicio=()=>{
  const alerts=[];
  obras.filter(noCuadrada).forEach(o=>alerts.push(`<li><span class="chip bad">Por cuadrar</span><span><b>${esc(o.nombre)}</b>: la diferencia entre presupuesto y lo pagado por el cliente es de ${clp(o.descuadre)} neto. No se puede cerrar hasta cobrarlo o declararlo como no pagado.</span></li>`));
  obras.filter(o=>ccPendiente(o)>0).forEach(o=>alerts.push(`<li><span class="chip warn">Casa Construcción</span><span><b>${esc(o.nombre)}</b>: le faltan por transferir ${clp(ccPlata(o))} (con IVA) de participación${o.abierta?' sobre lo que ya pagó el cliente (estimado)':''}.</span></li>`));
  C.pend_pagos.forEach(p=>alerts.push(`<li><span class="chip warn">Por pagar</span><span><b>${esc(p.quien)}</b> ${clp(p.total)} · ${esc(p.obra)} · ${fdate(p.fecha)}</span></li>`));
  const open=obras.filter(o=>o.abierta);
  return `<div><h1>Cómo va Happy Home</h1><p class="sub">Desde abril 2026 (datos cuadrados con el banco).</p></div>
  <details class="card noprint" style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:14px 18px"><summary style="cursor:pointer;font-weight:600">Qué hay en cada parte</summary><div class="grid g2" style="gap:6px 18px">
   <p class="sub" style="margin:0"><b>Obras:</b> margen de cada obra. Toca una para ver su ficha, sus movimientos y cerrarla.</p>
   <p class="sub" style="margin:0"><b>Cotizar:</b> precio a partir de costos, comparado con obras reales. Al aprobar, crea la obra.</p>
   <p class="sub" style="margin:0"><b>Movimientos:</b> todos los pagos y cobros. Toca uno para ver el detalle, marcarlo pagado o corregirlo.</p>
   <p class="sub" style="margin:0"><b>Caja:</b> plata libre, por cobrar y las próximas 8 semanas.</p>
   <p class="sub" style="margin:0"><b>Resultado:</b> ganancia de cada mes y punto de equilibrio.</p>
   <p class="sub" style="margin:0"><b>Más:</b> reporte para Max, conciliación con el banco, IVA, socios y CC, proveedores y clientes.</p>
   <p class="sub" style="margin:0"><b>+ Registrar:</b> anotar un pago o cobro; muestra cómo afecta antes de guardar.</p>
  </div></details>
  <section class="card"><div class="grid g4">
    ${(()=>{const C_=obras.filter(o=>!o.abierta), A_=obras.filter(o=>o.abierta); const sm=(L,k)=>sum(L.map(o=>o[k]||0));
      const genHH=tot.mc-sum(obras.map(ccPendiente))-(tot.e+tot.f);
      return `<button type="button" class="kpi kbtn" data-fobr-go="cerrada"><span>Obras cerradas (desde abril)</span><b>${clp(sm(C_,'margen'))}</b><small>margen real sin IVA de ${C_.length} obras · para HH ${clp(sm(C_,'margen_hh'))} después de CC</small><small class="ver">Ver obras →</small></button>
    <button type="button" class="kpi kbtn" data-fobr-go="abierta"><span>Obras en curso</span><b>${clp(sm(A_,'margen'))}</b><small>margen proyectado sin IVA de ${A_.length} obras · para HH ${clp(sm(A_,'margen_hh'))}</small><small class="ver">Ver obras →</small></button>
    <button type="button" class="kpi kbtn" data-go="reparto"><span>Ganado por HH desde abril</span><b class="${genHH>=0?'pos':'negc'}">${clp(genHH)}</b><small>lo que dejaron las obras, menos lo de CC y los gastos generales</small><small class="ver">Ver reparto →</small></button>`;})()}
    <button type="button" class="kpi kbtn" data-k="libre"><span>Plata libre hoy</span><b class="${libre>=0?'pos':'negc'}">${clp(libre)}</b><small>banco ${clp(cajaTotal)} − comprometido ${clp(cajaTotal-libre)}</small><small class="ver">Ver de dónde sale →</small></button>
    <button type="button" class="kpi kbtn" data-k="cobrar"><span>Por cobrar</span><b>${clp(porCobrar)}</b><small>lo que los clientes todavía deben pagar (con IVA)</small><small class="ver">Ver detalle →</small></button>
  </div></section>
  <div class="grid g2">
    <section class="card"><h2>Obras en curso</h2><div class="tbl"><table><thead><tr><th>Obra</th><th class="n">Margen proyectado</th><th>Gasto vs. estimado</th></tr></thead><tbody>
    ${open.map(o=>`<tr class="click" data-obra="${o.id}"><td>${esc(o.nombre)}<br><span class="chip ${o.un}">${o.un}</span></td><td class="n">${clp(o.margen)}<br><small class="${o.margen_pct>=20?'pos':'negc'}">${pct(o.margen_pct)}</small></td><td style="min-width:120px">${o.avance_gasto!=null?`<div class="bar"><i class="${o.avance_gasto>100?'bad':o.avance_gasto>85?'warn':''}" style="width:${Math.min(100,o.avance_gasto)}%"></i></div><small class="num">${pct(o.avance_gasto)}</small>`:'<small>sin costo estimado</small>'}</td></tr>`).join('')}
    </tbody></table></div></section>
    <section class="card"><h2>Requiere atención</h2><ul class="alerts">${alerts.join('')||'<li>Nada pendiente.</li>'}</ul></section>
  </div>`;
};
let fobr='', fob='';
V.obras=()=>{
  const flt=o=>!fobr||(fobr==='abierta'?o.abierta:fobr==='cerrada'?(!o.abierta&&!noCuadrada(o)):(!o.abierta&&noCuadrada(o)));
  const qo=nrm(fob.trim()); const base=qo?obrasAll:obras;
  const rows=base.filter(flt).filter(o=>!qo||nrm(o.nombre+' '+(o.cliente||'')+' '+o.id+' '+(o.notas||'')).includes(qo)).map(o=>{
    const st=o.abierta?'<span class="chip open dot">En curso</span>':noCuadrada(o)?'<span class="chip bad dot">Por cuadrar</span>':'<span class="chip dot">Cerrada</span>';
    return `<tr class="click" data-obra="${o.id}"><td><b>${esc(o.nombre)}</b><br><small>${esc(o.cliente||'')}</small></td><td><span class="chip ${o.un}">${o.un}</span></td><td>${st}</td>
    <td class="n">${clp(o.pres_neto)}</td><td class="n">${clp(o.abierta?o.costo_final:o.costo_real)}</td><td class="n ${o.margen>=0?'':'negc'}">${clp(o.margen)}</td><td class="n">${o.pres_neto||o.cobrado_neto?pct(o.margen_pct):'—'}</td><td class="n">${o.un==='Construcción'?clp(o.margen-o.cc_parte):clp(o.margen)}</td><td class="n">${o.abierta&&o.costo_est?`<span class="${o.costo_est-o.costo_real<0?'negc':''}">${clp(o.costo_est-o.costo_real)}</span>`:'—'}</td></tr>`}).join('');
  return `<div><h1>Obras</h1><p class="sub">Margen = ventas netas − costos directos (materiales, subcontratos, fletes…). En construcción, la mitad del margen es la participación de Casa Construcción, que es costo para Happy Home. En obras en curso se usa el costo estimado mientras el gasto real no lo supere. Toca una obra para ver su ficha.</p></div>
  <section class="card"><label style="margin-bottom:10px">Buscar obra<input id="fob" value="${esc(fob)}" placeholder="Nombre, cliente o código (busca también en obras antiguas)"></label><div class="spread" style="margin-bottom:10px"><div class="seg">${[['','Todas'],['abierta','En curso'],['cerrada','Cerradas'],['cuadrar','Por cuadrar']].map(([k,t])=>`<button type="button" data-fobr="${k}" aria-pressed="${fobr===k}">${t} <small>${obras.filter(o=>!k||(k==='abierta'?o.abierta:k==='cerrada'?(!o.abierta&&!noCuadrada(o)):(!o.abierta&&noCuadrada(o)))).length}</small></button>`).join('')}</div><div class="row solo-ros"><button class="btn" type="button" data-act="obra-new">+ Nueva obra</button><button class="btn ghost" type="button" data-go="cotizar">Desde cotización</button></div></div><div class="tbl"><table><thead><tr><th>Obra</th><th>Unidad</th><th>Estado</th><th class="n">Presupuesto neto</th><th class="n">Costo directo</th><th class="n">Margen obra</th><th class="n">%</th><th class="n">Queda para HH</th><th class="n">Queda para gastar</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
};
function ficha(id){
  const o=obrasAll.find(x=>x.id===id); if(!o) return;
  const cc=o.un==='Construcción';
  const cob=o.pres_total?Math.min(100,o.cobrado_total/o.pres_total*100):0;
  $('#dlgT').innerHTML=`<h2 style="margin:0">${esc(o.nombre)}</h2><div class="row"><span class="chip ${o.un}">${o.un}</span>${o.abierta?'<span class="chip open dot">En curso</span>':noCuadrada(o)?'<span class="chip bad dot">Por cuadrar</span>':'<span class="chip dot">Cerrada</span>'}<small class="sub" style="margin:0">${esc(o.cliente||'')}${o.inicio?' · inicio '+fdate(o.inicio):''}</small></div>`;
  const cuentas=Object.entries(o.cuentas).filter(([k,v])=>v);
  $('#dlgB').innerHTML=`
  <div class="row solo-ros noprint"><button class="btn" type="button" data-act="ob-reg" data-t="pago" data-id="${o.id}">+ Pago / gasto de esta obra</button><button class="btn ghost" type="button" data-act="ob-reg" data-t="cobro" data-id="${o.id}">+ Cobro al cliente</button><button class="btn ghost" type="button" data-act="ob-reg" data-t="reemb" data-id="${o.id}">+ Reembolso del cliente</button><button class="btn ghost" type="button" data-act="ob-reg" data-t="socio" data-id="${o.id}">+ Gasto pagado por socio</button></div>
  <div class="grid g4">
   <div class="kpi"><span>Presupuesto neto</span><b>${clp(o.pres_neto)}</b><small>${clp(o.pres_total)} con IVA</small></div>
   <div class="kpi"><span>${o.abierta?'Gastado a la fecha':'Costo directo'}</span><b>${clp(o.costo_real)}</b><small>${o.abierta&&o.costo_est?'de un costo estimado de '+clp(o.costo_est)+' · ':''}sin IVA · con IVA ${clp(o.costo_con_iva)} · sin Casa Construcción, menos reembolsos</small></div>
   <div class="kpi"><span>Margen ${o.abierta?'proyectado':'real'}</span><b class="${o.margen>=0?'pos':'negc'}">${clp(o.margen)}</b><small>${pct(o.margen_pct)}${o.abierta?' · presupuesto − '+(o.costo_final>o.costo_real?'costo estimado':'gastado'):''}</small></div>
   ${cc?`<div class="kpi"><span>Queda para Happy Home</span><b>${clp(o.margen-o.cc_parte)}</b><small>después de Casa Construcción</small></div>`:`<div class="kpi"><span>Pagado por el cliente</span><b>${clp(o.cobrado_total)}</b><small>con IVA</small></div>`}
  </div>
  ${noCuadrada(o)?`<p class="note bad"><b>No cuadra:</b> faltan ${clp(o.descuadre)} netos entre el presupuesto y lo pagado por el cliente. Para cerrarla hay que registrar el pago que falta o declararlo como "monto no pagado por el cliente".</p>`:''}
  <div><h3>Cobro al cliente</h3><div class="bar"><i style="width:${cob}%"></i></div><div class="spread"><small class="num">${clp(o.cobrado_total)} pagado por el cliente</small><small class="num">${o.abierta?clp(o.por_cobrar)+' por cobrar':''}</small></div></div>
  ${o.abierta?(()=>{const tope=o.costo_est||0; const pend=sum(D.movs.filter(m=>m.obra_id===o.id&&!m.pagado&&m.nat==='Costo directo').map(m=>m.neto)); const disp=tope-o.costo_real; const r=repartoObra(o);
    if(!tope) return `<div class="note">Esta obra no tiene costo estimado, así que no se puede calcular cuánto queda para gastar. Ponlo en <b>Editar datos de la obra</b> (o el margen que quieren ganar).</div>`;
    return `<div><h3>¿Cuánto queda para gastar?</h3><div class="grid g2"><div class="tbl"><table><tbody>
     <tr><td>Presupuesto (sin IVA)</td><td class="n">${clp(o.pres_neto)}</td></tr>
     <tr><td>− Ganancia que queremos <small>(${pct(o.pres_neto?(o.pres_neto-tope)/o.pres_neto*100:0)})</small></td><td class="n">${clp(-(o.pres_neto-tope))}</td></tr>
     <tr class="tot"><td>= Tope de gasto</td><td class="n">${clp(tope)}</td></tr>
     <tr><td>− Gastado a la fecha${pend?` <small>(incluye ${clp(pend)} registrados por pagar)</small>`:''}</td><td class="n">${clp(-o.costo_real)}</td></tr>
     <tr class="tot"><td>= Queda para gastar (sin IVA)</td><td class="n ${disp<0?'negc':'pos'}">${clp(disp)}</td></tr>
     <tr><td><small>En plata, si se compra con factura</small></td><td class="n"><small>${clp(disp*1.19)} con IVA</small></td></tr>
    </tbody></table></div>
    <div class="effect">
     <div><span>Plata de la obra hoy <small>(pagado por el cliente − gastado − repartido)</small></span><b class="num ${r.cajaObra<0?'negc':''}">${clp(r.cajaObra)}</b></div>
     <div><span>Falta que pague el cliente <small>(sin IVA)</small></span><b class="num">${clp(r.faltaCobrar)}</b></div>
     ${disp<0?`<p class="note bad">Se pasó del tope por ${clp(-disp)}: la ganancia ya es menor a la que querían.</p>`:o.avance_gasto>85?`<p class="note">Va en ${pct(o.avance_gasto)} del tope. Ojo con los gastos que quedan.</p>`:''}
     <p class="help">Se mide sin IVA porque el IVA de las facturas de compra lo recupera HH en el F29. El tope cambia si editas el costo estimado o el margen que quieren ganar.</p>
    </div></div></div>`;})():''}
  <div class="tbl"><table><thead><tr><th>Costo por cuenta</th><th class="n">Neto</th></tr></thead><tbody>
   ${cuentas.map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${clp(v)}</td></tr>`).join('')}
   <tr class="tot"><td>Costo directo</td><td class="n">${clp(o.costo_real)}</td></tr>
   ${o.perdida?`<tr><td>Monto no pagado por el cliente</td><td class="n negc">${clp(o.perdida)}</td></tr>`:''}
  </tbody></table></div>
  ${cc?(()=>{const pc=o.pres_neto?o.cobrado_neto/o.pres_neto:0; const gan=o.abierta?Math.round(o.cc_parte*pc):o.cc_parte; return `<div class="tbl"><table><thead><tr><th>Casa Construcción (50% del margen)</th><th class="n">Sin IVA</th><th class="n">Plata real (con IVA)</th></tr></thead><tbody>
    <tr><td>Participación total ${o.abierta?'proyectada':''}</td><td class="n">${clp(o.cc_parte)}</td><td class="n">${clp(o.cc_parte*1.19)}</td></tr>
    ${o.abierta?`<tr><td>Le corresponde por lo que ya pagó el cliente (${pct(pc*100)})</td><td class="n">${clp(gan)}</td><td class="n">${clp(gan*1.19)}</td></tr>`:''}
    <tr><td>Ya transferido</td><td class="n">${clp(o.cc_pagado)}</td><td class="n">${clp(o.cc_pagado_total)}</td></tr>
    <tr class="tot"><td>Falta transferir${o.abierta?' (estimado)':''}</td><td class="n">${clp(ccPendiente(o))}</td><td class="n">${clp(ccPlata(o))}</td></tr></tbody></table></div><p class="help">CC factura su participación: de lo que le transfieres, el IVA lo recupera HH en el F29.</p>`;})():''}
  <div><h3>Movimientos de esta obra</h3><div class="tbl"><table><thead><tr><th>Fecha</th><th>Quién</th><th>Qué es</th><th class="n">Monto</th></tr></thead><tbody>
   ${D.movs.filter(m=>m.obra_n===o.nombre).map(m=>`<tr data-mov="${m.id}"><td class="num">${fdate(m.fecha)}</td><td>${esc(m.quien)}${m.detalle?`<br><small class="sub">${esc(m.detalle.slice(0,50))}</small>`:''}</td><td><span class="chip ${m.nat==='Venta'?'open':''}">${esc(m.cuenta)}</span>${!m.pagado?' <span class="chip warn">Pendiente</span>':''}</td><td class="n ${m.tipo==='ingreso'?'pos':''}">${m.tipo==='ingreso'?'+':'−'}${clp(m.total)}</td></tr>`).join('')||'<tr><td colspan="4">Sin movimientos desde abril.</td></tr>'}
  </tbody></table></div><p class="help">Verde y con + : plata que entró. Con − : plata que salió. Incluye todo el historial de la obra.</p></div>
  ${o.cierre?`<div><h3>Cierre</h3><p class="sub" style="margin:0">${o.cierre.q?o.cierre.q+' '+esc(o.cierre.u)+' · '+clp(o.pres_neto/o.cierre.q)+' por '+esc(o.cierre.u)+' · ':''}${o.cierre.dias?o.cierre.dias+' días · ':''}${esc(o.cierre.apr||'')}</p></div>`:''}
  <div class="row solo-ros"><button class="btn ghost" type="button" data-act="obra-edit" data-id="${o.id}">Editar datos de la obra</button>${o.un==='Aseo'?`<button class="btn ghost" type="button" data-act="mes-sig" data-id="${o.id}">Crear el mes siguiente</button>`:''}</div>
  ${o.abierta?`<div class="row solo-ros"><button class="btn" type="button" data-act="cierre" data-id="${o.id}">Cerrar obra…</button><small class="sub" style="margin:0">Revisa que todo cuadre antes de cerrarla.</small></div>`:`<p class="help">Ficha cerrada: alimenta el cotizador con costo real por partida, margen y aprendizajes.</p>`}`;
  $('#dlg').showModal();
}
V.resultado=()=>{
  const T=meses.map(mesTot);
  const uns=['Construcción','Pasto','Aseo'];
  const tk=k=>sum(meses.map(m=>R[m].estructura[k]||0)); const estrK=[...new Set(meses.flatMap(m=>Object.keys(R[m].estructura)))].sort((x,y)=>tk(y)-tk(x));
  const noK=[...new Set(meses.flatMap(m=>Object.keys(R[m].noafecta)))];
  const cell=v=>`<td class="n">${v?clp(v):'—'}</td>`;
  const line=(lab,arr,cls='')=>`<tr class="${cls}"><td>${lab}</td>${arr.map(cell).join('')}<td class="n"><b>${clp(sum(arr))}</b></td></tr>`;
  const pe=tot.mc/tot.v, estrMes=(tot.e+tot.f)/meses.length;
  return `<div><h1>Resultado mensual</h1><p class="sub">Base caja: cada venta y cada costo se cuentan en el mes en que entró o salió la plata. Por eso un mes con muchas compras para una obra puede verse bajo aunque la obra vaya bien; para eso está la vista de Obras.</p></div>
  <section class="card"><div class="tbl"><table><thead><tr><th></th>${meses.map(m=>`<th class="n">${MES[+m.slice(5)-1]}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
   <tr class="sec"><td colspan="${meses.length+2}">Ventas netas (sin IVA)</td></tr>
   ${uns.map(u=>line(u,meses.map(m=>R[m].ventas[u]||0))).join('')}
   ${line('<b>Total ventas</b>',T.map(t=>t.v),'tot')}
   <tr class="sec"><td colspan="${meses.length+2}">Costos directos de obra (incluye Casa Construcción, neto de reembolsos)</td></tr>
   ${uns.map(u=>line(u,meses.map(m=>R[m].directo[u]||0))).join('')}
   ${line('<b>Margen de contribución</b>',T.map(t=>t.mc),'tot')}
   <tr class="sec"><td colspan="${meses.length+2}">Gastos generales (mantener la empresa, sin obra)</td></tr>
   ${estrK.map(k=>line(esc(k),meses.map(m=>R[m].estructura[k]||0))).join('')}
   ${line('Comisiones e intereses',T.map(t=>t.f))}
   ${line('<b>Resultado del mes</b>',T.map(t=>t.res),'tot')}
  </tbody></table></div></section>
  <div class="grid g2">
  <section class="card"><h2>Punto de equilibrio</h2><p class="sub">Los gastos generales cuestan en promedio <b class="num">${clp(estrMes)}</b> al mes. Con un margen de contribución de <b>${pct(pe*100)}</b>, hay que vender al menos <b class="num">${clp(estrMes/pe)}</b> netos al mes para no perder plata.</p></section>
  <section class="card"><h2>No afecta el resultado</h2><p class="sub" style="margin:0 0 8px">Salió o entró plata, pero no es venta ni costo.</p><div class="tbl"><table><tbody>
   ${noK.map(k=>`<tr><td>${esc(k)}</td><td class="n">${clp(sum(meses.map(m=>R[m].noafecta[k]||0)))}</td></tr>`).join('')}</tbody></table></div></section>
  </div>`;
};
/* caja + proyección */
const semanas=[...Array(8)].map((_,i)=>{const d=new Date(HOY+'T12:00:00');d.setDate(d.getDate()+i*7);return d});
const plan={};
function proyeccion(){
  let saldo=cajaTotal; const out=[];
  const fijoSem=C.estructura_prom/4.33;
  semanas.forEach((d,i)=>{
    let ent=0, sal=fijoSem;
    Object.values(plan).forEach(p=>{if(+p.sem===i) ent+=p.monto});
    if(i===0) sal+=pagosPend;
    if(i===2) sal+=ivaPagar; // F29 día 20
    if(i===1) sal+=ccPend*0.5; if(i===4) sal+=ccPend*0.5;
    saldo+=ent-sal; out.push({d,ent,sal,saldo});
  }); return out;
}
V.caja=()=>{
  const P=proyeccion(); const mx=Math.max(...P.map(p=>Math.abs(p.saldo)),1);
  return `<div><h1>Caja</h1><p class="sub">Tres preguntas: cuánta plata es realmente libre hoy, quién nos debe y qué viene en las próximas 8 semanas.</p><div class="row" style="margin-top:8px"><button class="btn ghost" type="button" data-go="reparto">Ver reparto del mes y cuánto se puede sacar →</button></div></div>
  <div class="grid g2">
  <section class="card"><h2>Plata libre hoy</h2>${desgloseLibre()}</section>
  <section class="card"><h2>Por cobrar</h2><div class="tbl"><table><thead><tr><th>Qué</th><th class="n">Monto</th><th>Cuándo espero cobrar</th></tr></thead><tbody>
    ${porCobrarObras.map(x=>`<tr><td>${esc(x.o.nombre)}<br><small>saldo del presupuesto, con IVA</small></td><td class="n">${clp(x.monto)}</td><td><select data-plan="${x.o.id}" aria-label="Semana de cobro">${semanas.map((d,i)=>`<option value="${i}" ${plan[x.o.id].sem==i?'selected':''}>sem. ${d.getDate()}-${MES[d.getMonth()]}</option>`).join('')}<option value="99" ${plan[x.o.id].sem==99?'selected':''}>después</option></select></td></tr>`).join('')}
    ${cobrosExtra.map(p=>`<tr><td>${esc(p.quien)} · ${esc(p.tipo)}<br><small>${esc(p.obra)} · ${fdate(p.fecha)}</small></td><td class="n">${clp(p.total)}</td><td><small>pendiente</small></td></tr>`).join('')}
  </tbody></table></div></section>
  </div>
  <section class="card"><div class="spread"><h2>Próximas 8 semanas</h2><small class="sub" style="margin:0">Parte sin ningún cobro: elige en «Por cobrar» la semana en que esperas cada pago y mira cómo se mueve el saldo.</small></div>
    <div class="wk" role="img" aria-label="Saldo proyectado por semana">${P.map(p=>`<div><span class="num">${mill(p.saldo)}</span><i class="b ${p.saldo<0?'neg':''}" style="height:${Math.max(3,Math.abs(p.saldo)/mx*110)}px"></i><span>${p.d.getDate()}-${MES[p.d.getMonth()]}</span></div>`).join('')}</div>
    <div class="tbl"><table><thead><tr><th>Semana</th><th class="n">Entra</th><th class="n">Sale</th><th class="n">Saldo</th></tr></thead><tbody>
    ${P.map(p=>`<tr><td>${p.d.getDate()}-${MES[p.d.getMonth()]}</td><td class="n">${clp(p.ent)}</td><td class="n">${clp(p.sal)}</td><td class="n ${p.saldo<0?'negc':''}">${clp(p.saldo)}</td></tr>`).join('')}</tbody></table></div>
    <p class="help">Sale cada semana el promedio de gastos generales (${clp(C.estructura_prom)} al mes). La semana 1 incluye los pagos pendientes, y la participación de Casa Construcción se reparte en dos pagos. Falta agregar los pagos futuros a proveedores de Campanil: en la app real se cargan al registrar cada orden o factura.</p>
  </section>`;
};
let fq='',fnat='',fobra='',fest='';
V.movs=()=>{
  const nats=[...new Set(D.movs.filter(m=>m.pagado).map(m=>m.nat))];
  const obrasN=[...new Set(D.movs.map(m=>m.obra_n))].sort();
  const pend=D.movs.filter(m=>!m.pagado);
  const pp=pend.filter(m=>m.tipo==='egreso'&&m.nat!=='Pérdida'), pc=pend.filter(m=>m.tipo==='ingreso'&&['Venta','Recupero'].includes(m.nat));
  const ord=L=>L.slice().sort((a,b)=>(a.fecha||'0000').localeCompare(b.fecha||'0000'));
  const lista=(L,ing)=>L.length?`<div class="tbl"><table><tbody>${ord(L).map(m=>`<tr data-mov="${m.id}"><td class="num">${m.fecha?fdate(m.fecha):'<span class="negc">sin fecha</span>'}</td><td><b>${esc(m.quien)}</b><br><small class="sub">${esc(m.obra_n)}${m.detalle?' · '+esc(m.detalle.slice(0,45)):''}</small></td><td class="n">${clp(m.total)}</td><td class="solo-ros"><button class="x" type="button" data-act="rapido" data-id="${m.id}">Pagado</button></td></tr>`).join('')}
    <tr class="tot"><td colspan="2">Total</td><td class="n">${clp(sum(L.map(m=>m.total)))}</td><td class="solo-ros"></td></tr></tbody></table></div>`:'<p class="sub">Nada pendiente.</p>';
  return `<div><h1>Movimientos</h1><p class="sub">Arriba lo que falta pagar o cobrar; abajo lo ya realizado. Toca cualquiera para ver el detalle o corregirlo.</p></div>
  <div class="grid g2">
   <section class="card"><h2>Por pagar <small class="sub">${pp.length}</small></h2>${lista(pp,false)}</section>
   <section class="card"><h2>Por cobrar <small class="sub">${pc.length}</small></h2>${lista(pc,true)}<p class="help">Son cobros y reembolsos ya registrados como pendientes. El saldo por cobrar de cada obra en curso está en Caja.</p></section>
  </div>
  ${(()=>{const L=D.movs.filter(m=>['falta','por_emitir'].includes(m.estado_doc)).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')); if(!L.length) return '';
    const fe=L.filter(m=>m.tipo==='ingreso'), fr=L.filter(m=>m.tipo==='egreso');
    const tb=X=>`<div class="tbl" style="max-height:320px;overflow:auto"><table><tbody>${X.map(m=>`<tr data-mov="${m.id}"><td class="num">${fdate(m.fecha)}</td><td><b>${esc(m.quien)}</b><br><small class="sub">${esc(m.obra_n)} · ${esc(m.doc)}${m.ndoc?' N° '+esc(m.ndoc):''}</small></td><td class="n">${clp(m.total)}</td><td class="solo-ros"><button class="x" type="button" data-act="doc-ok" data-id="${m.id}">${m.tipo==='ingreso'?'Enviada':'Recibido'}</button></td></tr>`).join('')}</tbody></table></div>`;
    return `<details class="card" style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:14px 18px"><summary style="cursor:pointer;font-weight:600">Documentos pendientes: ${fr.length} por recibir · ${fe.length} facturas por enviar</summary><div class="grid g2" style="margin-top:10px"><div><h3>Por recibir de proveedores</h3>${fr.length?tb(fr):'<p class="sub">Nada.</p>'}</div><div><h3>Facturas por enviar a clientes</h3>${fe.length?tb(fe):'<p class="sub">Nada.</p>'}</div></div><p class="help">Vienen de la app vieja: muchos pueden estar ya resueltos. Márcalos cuando corresponda.</p></details>`;})()}
  <section class="card"><h2>Realizados</h2><div class="filters">
   <label>Buscar<input id="fq" placeholder="Proveedor, detalle, N° documento o monto" value="${esc(fq)}"></label>
   <label>Tipo<select id="fnat"><option value="">Todos</option>${nats.map(n=>`<option value="${n}" ${n===fnat?'selected':''}>${NATL(n)}</option>`).join('')}</select></label>
   <label>Obra<select id="fobra"><option value="">Todas</option>${obrasN.map(n=>`<option ${n===fobra?'selected':''}>${esc(n)}</option>`).join('')}</select></label>
   <label>Documento<select id="fest"><option value="">Todos</option><option value="falta" ${fest==='falta'?'selected':''}>Falta factura / enviar</option><option value="por_emitir" ${fest==='por_emitir'?'selected':''}>Hacer boleta</option><option value="ok" ${fest==='ok'?'selected':''}>Recibido / enviado</option><option value="no_aplica" ${fest==='no_aplica'?'selected':''}>No aplica</option></select></label>
  </div><div id="movT" style="margin-top:12px"></div></section>`;
};
function movTable(){
  const q=fq.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''), qd=fq.replace(/\D/g,'');
  let L=D.movs.filter(m=>m.pagado&&(!fnat||m.nat===fnat)&&(!fobra||m.obra_n===fobra)&&(!fest||(m.estado_doc||'no_aplica')===fest)
    &&(!q||((m.quien||'')+' '+(m.detalle||'')+' '+(m.ndoc||'')+' '+m.cuenta).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').includes(q)||(qd&&String(m.total).includes(qd))));
  const n=L.length; L=L.slice(0,150);
  $('#movT').innerHTML=`<small class="sub">${n} movimientos${n>150?' · se muestran los 150 más recientes':''}</small><div class="tbl"><table><thead><tr><th>Fecha</th><th>Quién</th><th>Qué es</th><th>Obra</th><th>Doc.</th><th class="n">Total</th><th class="n">IVA</th></tr></thead><tbody>
  ${L.map(m=>`<tr data-mov="${m.id}"><td class="num">${fdate(m.fecha)}</td><td>${esc(m.quien)}${m.detalle?`<br><small class="sub">${esc(m.detalle.slice(0,60))}</small>`:''}</td><td><span class="chip ${m.nat==='Venta'?'open':m.nat==='Pérdida'?'bad':''}">${esc(m.cuenta)}</span>${esFijo(m)?' <span class="chip">fijo</span>':''}${edocChip(m)}</td><td><small>${esc(m.obra_n)}</small></td><td><small>${esc(m.doc)}${m.ndoc?' '+esc(m.ndoc):''}</small></td><td class="n ${m.tipo==='ingreso'?'pos':''}">${m.tipo==='ingreso'?'+':''}${clp(m.total)}</td><td class="n">${m.iva?clp(m.iva):'—'}</td></tr>`).join('')}</tbody></table></div>`;
}
function rapido(id){
  const m=movById(id); if(!m) return;
  abrir((m.tipo==='ingreso'?'Marcar pagado por el cliente: ':'Marcar pagado: ')+esc(m.quien)+' '+clp(m.total),`<div class="form">
   <label>Fecha<input type="date" id="mp_f" value="${HOY}"></label>
   <label>${m.tipo==='ingreso'?'Entró a':'Desde'}<select id="mp_c">${MEDIOS.map(x=>`<option ${m.medio===x?'selected':''}>${x}</option>`).join('')}</select></label></div>
   <div class="row"><button class="btn" type="button" data-act="pagar" data-id="${m.id}">Confirmar</button></div>`);
}
/* ---------- gastos fijos ---------- */
const FIJOS=[
 {n:'Contador (Vicente Vergara)',k:['vicente','vergara'],cuenta:'Remuneraciones y honorarios'},
 {n:'Previred',k:['previred'],cuenta:'Remuneraciones y honorarios'},
 {n:'Entel',k:['entel'],cuenta:'Teléfono e internet'},
 {n:'TAG',k:['tag','autopista'],cuenta:'Vehículo y traslados',tambienObra:true},
 {n:'Bencina',k:['shell','copec','bencina'],cuenta:'Vehículo y traslados'},
 {n:'Seguro auto',k:['seguro auto','bci seguros','seguro bci','pac bci'],cuenta:'Vehículo y traslados',tambienObra:true},
 {n:'Comisión banco',k:['comision','comisión'],cuenta:'Comisiones e intereses',soloNat:['Financiero']},
 {n:'Seguro banco (desgravamen)',k:['desgravamen'],cuenta:'Comisiones e intereses'},
 {n:'YouTube',k:['youtube'],cuenta:'Marketing'},
 {n:'Crédito auto',k:['credito auto','crédito auto'],cuenta:'Cuota de crédito',noafecta:true},
 {n:'Crédito Fogape',k:['fogape'],cuenta:'Cuota de crédito',noafecta:true},
 {n:'F29 (IVA)',k:['sii','tesoreria','tesorería','f29'],cuenta:'Pago F29 (IVA)',noafecta:true,impuesto:true},
];
const nrm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
function fijoDe(m){
  if(m.tipo!=='egreso'||!['Estructura','Financiero','No afecta','Costo directo'].includes(m.nat)) return null;
  const t=' '+nrm((m.quien||'')+' '+(m.detalle||''))+' ';
  return FIJOS.find(f=>(m.nat!=='Costo directo'||f.tambienObra)&&(!f.soloNat||f.soloNat.includes(m.nat))&&(!f.noafecta||m.nat==='No afecta')&&(f.noafecta||m.nat!=='No afecta')&&f.k.some(k=>new RegExp('(^|[^a-z])'+nrm(k)+'([^a-z]|$)').test(t)))||null;
}
const esFijo=m=>!!fijoDe(m);
V.fijos=()=>{
  const ms=meses; const mesAct=HOY.slice(0,7);
  const tab=FIJOS.map(f=>{const por={}; ms.forEach(mm=>por[mm]=0);
    D.movs.filter(m=>m.pagado&&m.fecha&&fijoDe(m)===f).forEach(m=>{const mm=m.fecha.slice(0,7); if(mm in por) por[mm]+=m.total;});
    const vals=ms.filter(mm=>mm<mesAct).map(mm=>por[mm]).filter(v=>v>0).sort((a,b)=>a-b);
    const tipico=vals.length?vals[Math.floor(vals.length/2)]:0;
    const conPago=ms.filter(mm=>por[mm]>0); const primero=conPago[0]||null;
    const ult3=ms.filter(mm=>mm<mesAct).slice(-3);
    const terminado=tipico>0&&ult3.length===3&&ult3.every(mm=>!(por[mm]>0))&&!(por[mesAct]>0);
    return {f,por,tipico,primero,terminado};});
  const celda=(r,mm,i)=>{const v=r.por[mm]; if(!r.primero||mm<r.primero) return '<td class="n">—</td>';
    if(r.terminado&&mm>[...ms].filter(x=>r.por[x]>0).pop()) return '<td class="n"><small class="sub">terminado</small></td>';
    if(v>0){const ant=ms[i-1]; const doble=!r.f.impuesto&&r.tipico&&(v>=1.7*r.tipico||(ant&&ant>=r.primero&&!(r.por[ant]>0)&&v>=1.25*r.tipico)); return `<td class="n">${clp(v)}${doble?'<br><small class="sub">2 meses</small>':''}</td>`;}
    const sig=ms[i+1]; if(!r.f.impuesto&&sig&&r.tipico&&r.por[sig]>=1.25*r.tipico) return `<td class="n"><small class="sub">junto con el siguiente</small></td>`;
    if(mm===mesAct) return `<td class="n"><span class="chip warn">pendiente</span></td>`;
    return `<td class="n">${r.tipico?'<span class="chip bad">no pagado</span>':'—'}</td>`;};
  const activos=tab.filter(r=>r.tipico>0&&!r.terminado);
  const pagadoMes=sum(activos.map(r=>r.por[mesAct]||0)), esperadoMes=sum(activos.filter(r=>!r.f.impuesto).map(r=>r.tipico));
  const faltan=activos.filter(r=>!r.f.impuesto&&!(r.por[mesAct]>0));
  return `<div>${backBtn}<h1>Gastos fijos</h1><p class="sub">Los pagos que se repiten todos los meses. La app los reconoce por palabra clave en el nombre o el detalle del movimiento.</p></div>
  <section class="card"><div class="grid g4">
   <div class="kpi"><span>Fijos de un mes normal</span><b>${clp(esperadoMes)}</b><small>sin contar el F29</small></div>
   <div class="kpi"><span>Pagado este mes (${MESL[+mesAct.slice(5)-1]})</span><b>${clp(pagadoMes)}</b></div>
   <div class="kpi"><span>Faltan este mes</span><b class="${faltan.length?'negc':''}">${faltan.length}</b><small>${esc(faltan.map(r=>r.f.n).join(', ')||'nada')}</small></div>
  </div></section>
  <section class="card"><div class="tbl"><table><thead><tr><th>Gasto fijo</th><th class="n">Monto habitual</th>${ms.map(mm=>`<th class="n">${MES[+mm.slice(5)-1]}</th>`).join('')}<th class="solo-ros"></th></tr></thead><tbody>
   ${tab.map(r=>`<tr><td><b>${esc(r.f.n)}</b>${r.terminado?' <span class="chip">sin pagos hace 3 meses</span>':''}<br><small class="sub">${esc(r.f.cuenta)}${r.f.noafecta?' · no afecta resultado':''}</small></td><td class="n">${r.tipico?clp(r.tipico):'—'}</td>${ms.map((mm,i)=>celda(r,mm,i)).join('')}<td class="solo-ros">${r.tipico&&!r.terminado&&!(r.por[mesAct]>0)?`<button class="x" type="button" data-act="fijo-reg" data-id="${FIJOS.indexOf(r.f)}">Registrar</button>`:''}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="help">"2 meses": se pagaron dos meses juntos. "Junto con el siguiente": ese mes no se pagó porque se pagó con el mes siguiente. El monto habitual es el valor típico de los meses anteriores. Si un gasto lleva 3 meses sin pagos se marca como terminado (ej. un crédito que se terminó de pagar) y deja de contarse.</p></section>`;
};
function fijoRegistrar(i){
  const f=FIJOS[i]; const r=V.fijos&&null; EDIT=null;
  const prev=D.movs.filter(m=>m.pagado&&fijoDe(m)===f).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''))[0];
  F={...F,tipo:f.cuenta==='Cuota de crédito'?'cuota':f.impuesto?'f29':'pago',prov:prev?prev.quien:f.n,obra:'',doc:prev?prev.doc:'Nada',ndoc:'',monto:prev?String(prev.total):'',fecha:HOY,cuenta:f.noafecta?'':f.cuenta,pagado:true,detalle:prev&&prev.detalle?prev.detalle:'',liga:'',medio:prev&&prev.medio||F.medio};
  show('nuevo');
}
/* registrar */
const TIPOS=[
 {k:'pago',t:'Pago a proveedor',d:'Compra o servicio de una obra o de la empresa',obra:'opt',doc:true,prov:true},
 {k:'cobro',t:'Cobro a cliente',d:'Factura o estado de pago al cliente',obra:'req',doc:true},
 {k:'socio',t:'Gasto pagado por un socio',d:'Se pagó con cuenta o tarjeta personal',obra:'opt',doc:true,prov:true},
 {k:'reemb',t:'Reembolso del cliente',d:'El cliente devuelve compras hechas por HH',obra:'req'},
 {k:'devol',t:'Devolución de proveedor',d:'Te devuelven un pago de más',obra:'req',prov:true},
 {k:'nopago',t:'Monto no pagado por el cliente',d:'Saldo que el cliente no pagará',obra:'req'},
 {k:'reembsocio',t:'Devolver a un socio',d:'HH le paga a un socio lo que puso de su bolsillo'},
 {k:'retiro',t:'Retiro de socio',d:'Max o Rosario retiran utilidad',obra:'opt'},
 {k:'f29',t:'Pago F29',d:'IVA mensual al SII'},
 {k:'cuota',t:'Cuota de crédito',d:'Auto, Fogape: capital + interés'},
 {k:'traspaso',t:'Traspaso entre cuentas',d:'Entre cuentas HH o la reserva'},
];
let F={tipo:'pago',prov:'',obra:'',doc:'Factura',ndoc:'',monto:'',medio:'Cuenta 159-46332-07',fecha:HOY,socio:'Rosario',interes:'',adj:false,cuenta:'',pagado:true,llego:'',detalle:'',liga:''};
const obrasSelF=()=>obras.filter(o=>o.abierta).concat(obras.filter(o=>!o.abierta));
V.nuevo=()=>`<div><h1>${EDIT?'Corregir '+EDIT:'Registrar movimiento'}</h1><p class="sub">Primero eliges qué pasó. La app calcula el IVA, pide lo necesario y muestra cómo afecta cada número antes de guardar.</p>${EDIT?`<p class="note">Estás corrigiendo ${EDIT}. Al guardar se reemplaza y la versión anterior queda en el historial. <button class="x" type="button" data-act="cancel-edit">Cancelar</button></p>`:''}${F.liga?`<p class="note">Devolución ligada a ${F.liga}: restará costo de la misma obra.</p>`:''}</div>
  <section class="card"><h2>¿Qué pasó?</h2><div class="types" id="types">${TIPOS.map(t=>`<button type="button" data-t="${t.k}" aria-pressed="${F.tipo===t.k}"><b>${t.t}</b><small>${t.d}</small></button>`).join('')}</div></section>
  <div class="grid g2"><section class="card"><form id="fm" class="form" novalidate></form></section>
  <section class="card"><h2>Así lo registra la app</h2><div class="effect" id="eff"></div><div id="warns" style="display:grid;gap:8px;margin-top:10px"></div>
  <div class="row" style="margin-top:14px"><button class="btn" id="save" type="button">Guardar</button></div></section></div>`;
function formHTML(){
  const t=TIPOS.find(x=>x.k===F.tipo);
  const provs=Object.keys(D.proveedores).sort();
  let h='';
  if(t.prov) h+=`<label>Proveedor<input id="f_prov" list="provs" value="${esc(F.prov)}" placeholder="Ej: Sodimac, Glendy Puyosa"><datalist id="provs">${provs.map(p=>`<option value="${esc(p)}">`).join('')}</datalist></label>`;
  if(t.k==='cobro'||t.k==='reemb'||t.k==='nopago') h+=`<label>Cliente<input id="f_prov" value="${esc(F.prov)}" placeholder="Se toma de la obra"></label>`;
  if(t.k==='retiro'||t.k==='socio'||t.k==='reembsocio') h+=`<label>Socio<select id="f_socio">${['Rosario','Max'].map(s=>`<option ${F.socio===s?'selected':''}>${s}</option>`).join('')}</select></label>`;
  if(t.prov) h+=`<label>Cuenta<select id="f_cuenta">${['','Materiales','Subcontrato / mano de obra','Arriendo equipos y herramientas','Fletes y traslados','Retiro de escombros','Viáticos','Participación CC','Comisión de cobro','Remuneraciones y honorarios','Teléfono e internet','Vehículo y traslados','Marketing','Patentes y permisos','Otros gastos generales'].map(c=>`<option ${F.cuenta===c?'selected':''} value="${c}">${c||'(la sugiere el proveedor)'}</option>`).join('')}</select></label>`;
  if(t.obra) h+=`<label>${t.k==='retiro'?'De qué obra <small>(opcional: para el reparto)</small>':'Obra'+(t.obra==='req'?'':' <small>(obligatoria si es costo de obra)</small>')}<select id="f_obra"><option value="">${t.obra==='req'?'Elige la obra':'General HH (sin obra)'}</option>${obrasSelF().map(o=>`<option value="${o.id}" ${F.obra===o.id?'selected':''}>${esc(o.nombre)}${o.abierta?'':' (cerrada)'}</option>`).join('')}</select></label>`;
  if(t.doc) h+=`<label>Documento<select id="f_doc">${['Factura','Boleta','Boleta de honorarios','Nada'].map(d=>`<option ${F.doc===d?'selected':''}>${d}</option>`).join('')}</select></label><label>N° documento<input id="f_ndoc" value="${esc(F.ndoc)}" inputmode="numeric"></label>`;
  if(t.doc) h+=`<label>Estado del documento<select id="f_edoc">${[['ok',t.k==='cobro'?'Factura enviada':'Recibido'],['falta',t.k==='cobro'?'Falta enviar factura':'Falta factura'],['por_emitir','Hacer boleta'],['no_aplica','No aplica']].map(([k,l])=>`<option value="${k}" ${(F.edoc||(F.doc==='Nada'?'no_aplica':'ok'))===k?'selected':''}>${l}</option>`).join('')}</select></label>`;
  if(['pago','socio'].includes(t.k)&&F.doc==='Boleta de honorarios') h+=`<label>¿Quién retiene el 15,25%?<select id="f_ret"><option value="hh" ${F.ret!=='emisor'?'selected':''}>Happy Home (la boleta dice "Impto. Retenido")</option><option value="emisor" ${F.ret==='emisor'?'selected':''}>El emisor (retención por el contribuyente)</option></select></label>`;
  h+=`<label>${['pago','socio'].includes(t.k)&&F.doc==='Boleta de honorarios'?'Monto pagado (el «Total» líquido de la boleta)':t.k==='cobro'?'Monto cobrado (total de la factura)':t.k==='reemb'?'Monto del reembolso':'Monto total pagado'}${t.k==='nopago'?' (con IVA, como en el presupuesto)':''}<input id="f_monto" inputmode="numeric" value="${esc(F.monto)}" placeholder="Ej: 628343"></label>`;
  if(t.k==='cuota') h+=`<label>De eso, intereses<input id="f_int" inputmode="numeric" value="${esc(F.interes)}" placeholder="Sale en la cartola del crédito"></label>`;
  if(t.k==='cobro') h+=`<label>Monto pagado por el cliente <small>(lo que llegó; si es menos, la diferencia es comisión)</small><input id="f_llego" inputmode="numeric" value="${esc(F.llego)}" placeholder="Igual al monto"></label>`;
  if(t.k==='reembsocio'){const dd=D.movs.filter(m=>m.cuenta==='Traspaso / pagado por socios'&&m.tipo==='egreso'&&!m.pagado&&m.id!==EDIT); h+=`<label>Qué se le devuelve<select id="f_liga"><option value="">—</option>${dd.map(m=>`<option value="${m.id}" ${F.liga===m.id?'selected':''}>${esc(m.quien)} ${clp(m.total)} · ${esc((m.detalle||'').slice(0,50))}</option>`).join('')}</select></label>`;}
  if(['pago','cobro','reemb'].includes(t.k)) h+=`<label>Estado<select id="f_pag"><option value="1" ${F.pagado?'selected':''}>Pagado</option><option value="0" ${!F.pagado?'selected':''}>Pendiente de pago</option></select></label>`;
  if(t.k!=='nopago'&&t.k!=='socio') h+=`<label>${t.k==='cobro'||t.k==='reemb'||t.k==='devol'?'Entra a':'Pagado con'}<select id="f_medio">${MEDIOS.map(m=>`<option ${F.medio===m?'selected':''}>${m}</option>`).join('')}</select></label>`;
  h+=`<label>Fecha<input id="f_fecha" type="date" value="${F.fecha}"></label><label>Detalle<input id="f_det" value="${esc(F.detalle)}" placeholder="Opcional"></label>`;
  h+=`<label>Respaldo (foto o PDF)<input id="f_adj" type="file" accept="image/*,application/pdf"></label>`;
  $('#fm').innerHTML=h; bindForm(); effects();
}
function bindForm(){
  const map={f_edoc:'edoc',f_ret:'ret',f_prov:'prov',f_obra:'obra',f_doc:'doc',f_ndoc:'ndoc',f_monto:'monto',f_medio:'medio',f_fecha:'fecha',f_socio:'socio',f_int:'interes',f_cuenta:'cuenta',f_llego:'llego',f_det:'detalle',f_liga:'liga'};
  const fpv=document.getElementById('f_prov'); if(fpv&&!EDIT) fpv.addEventListener('change',()=>{const k=nrm(fpv.value.trim()); if(!k) return; const u=D.movs.find(m=>m.tipo==='egreso'&&nrm(m.quien||'')===k&&m.quien!=='SII · retención honorarios'); if(u){ const cambioDoc=u.doc&&u.doc!==F.doc; if(cambioDoc){F.doc=u.doc; F.edoc='';} if(['pago','socio'].includes(F.tipo)&&!F.cuenta) F.cuenta=u.cuenta;
      setTimeout(()=>{const foco=document.activeElement&&document.activeElement.id; if(cambioDoc) formHTML(); else {const c=document.getElementById('f_cuenta'); if(c) c.value=F.cuenta; effects();} if(foco&&document.getElementById(foco)) document.getElementById(foco).focus();},0);
      toast('Documento y cuenta de la última vez: '+u.doc+' · '+u.cuenta);}});
  const fd=document.getElementById('f_doc'); if(fd) fd.addEventListener('change',()=>{F.doc=fd.value; F.edoc=fd.value==='Nada'?'no_aplica':''; formHTML();});
  const pg=document.getElementById('f_pag'); if(pg) pg.addEventListener('input',()=>{F.pagado=pg.value==='1'; effects();});
  const lg=document.getElementById('f_liga'); if(lg) lg.addEventListener('change',()=>{const m=movById(lg.value); if(m){F.monto=String(m.total); F.socio=/max/i.test(m.quien)?'Max':'Rosario'; formHTML();}});
  Object.entries(map).forEach(([id,k])=>{const el=document.getElementById(id); if(el) el.addEventListener('input',()=>{F[k]=el.value; if(k==='prov'){const p=D.proveedores[titleCase(el.value)]; if(p&&!F.cuenta){ /* sugerencia */ }} effects();})});
  const a=document.getElementById('f_adj'); if(a) a.addEventListener('change',()=>{F.adj=a.files.length>0; effects();});
}
const titleCase=s=>s.trim().toLowerCase().replace(/\b\p{L}/gu,c=>c.toUpperCase());
function calc(){
  const t=F.tipo, M=+String(F.monto).replace(/\D/g,'')||0; const o=obras.find(x=>x.id===F.obra);
  const p=D.proveedores[titleCase(F.prov)];
  let cuenta=F.cuenta||(p?p.cuenta:''); let nat=F.cuenta?(['Remuneraciones y honorarios','Teléfono e internet','Vehículo y traslados','Marketing','Patentes y permisos','Otros gastos generales'].includes(F.cuenta)?'Estructura':'Costo directo'):(p?p.nat:'');
  if((t==='pago'||t==='socio')&&!nat) nat=F.obra?'Costo directo':'Estructura';
  if((t==='pago'||t==='socio')&&nat==='Costo directo'&&!cuenta) cuenta='Materiales';
  if((t==='pago'||t==='socio')&&nat==='Estructura'&&!cuenta) cuenta='Otros gastos generales';
  let iva=0, neto=M, ret=0;
  if(['pago','cobro','socio'].includes(t)){
    if(F.doc==='Factura'){neto=Math.round(M/1.19); iva=M-neto;}
    if(F.doc==='Boleta de honorarios'&&F.ret!=='emisor'&&['pago','socio'].includes(t)){const bruto=Math.round(M/(1-0.1525)); ret=bruto-M; neto=bruto;}
  }
  if(t==='nopago'){neto=Math.round(M/1.19);}
  let interes=+String(F.interes).replace(/\D/g,'')||0;
  const tc = F.medio==='TC de la casa'||F.medio==='Cuenta personal socio'||t==='socio';
  const llego=t==='cobro'?(+String(F.llego).replace(/\D/g,'')||M):M; const com=Math.max(0,M-llego);
  return {t,M,o,p,cuenta,nat,iva,neto,ret,interes,tc,llego,com};
}
function effects(){
  const c=calc(); const W=[]; let rows=[];
  const on=c.o?esc(c.o.nombre):'—';
  const r=(a,b)=>`<div><span>${a}</span><b class="num">${b}</b></div>`;
  switch(c.t){
   case 'pago': case 'socio':
    rows.push(r('Cuenta',esc(c.cuenta||'—')+(c.p&&!F.cuenta?' <small>(la última vez)</small>':'')));
    if(!c.ret) rows.push(r('Neto (costo)',clp(c.neto))); rows.push(r('IVA crédito fiscal',F.doc==='Factura'?clp(c.iva):'$0 · solo la factura lleva IVA'));
    if(c.ret) rows.push(r('Honorario bruto (costo)',clp(c.neto)),r('Retención 15,25% (HH la paga al SII en el F29)',clp(c.ret)));
    rows.push(r(c.nat==='Costo directo'?'Baja el margen de':'Suma a gastos generales',c.nat==='Costo directo'?on:'gastos del mes'));
    rows.push(r('Caja de Happy Home',c.tc?'no se mueve · HH le debe '+clp(c.M)+' a '+(c.t==='socio'?F.socio:'quien pagó'):(F.pagado||c.t==='socio'?'sale ':'queda por pagar ')+clp(c.M)));
    if(c.tc) rows.push(r('Deuda con socio','se crea sola · aparece en Caja y en Socios'));
    if(c.nat==='Costo directo'&&!F.obra) W.push('<p class="note bad">Un costo directo necesita una obra. Elige la obra o elige «General HH (sin obra)» con una cuenta de gastos generales.</p>');
    break;
   case 'cobro': rows.push(r('Venta neta',clp(F.doc==='Factura'?c.neto:c.M)),r('IVA débito (sobre el total facturado)',clp(c.iva)),r('Sube lo pagado por el cliente en',on));
     if(c.com) rows.push(r('Comisión descontada (costo de la obra)',clp(c.com)),r('Se crean','2 movimientos: cobro '+clp(c.M)+' + comisión '+clp(c.com)));
     rows.push(r('Caja',F.pagado?'entra '+clp(c.llego):'queda por cobrar '+clp(c.M))); if(c.com>c.M*0.05) W.push('<p class="note">La comisión es más de 5% del cobro: revisa el monto que llegó.</p>'); break;
   case 'reembsocio': rows.push(r('Obra','no lleva: el costo ya quedó en la obra cuando el socio pagó'),r('Deuda con '+F.socio,F.liga?'queda en $0':'baja '+clp(c.M)),r('Caja','sale '+clp(c.M))); if(!F.liga) W.push('<p class="note">Elige qué gasto se le está devolviendo, así queda ligado.</p>'); break;
   case 'reemb': rows.push(r('Resta costo de',on),r('Monto',clp(c.M)),r('Venta','no es venta'),r('Caja','entra '+clp(c.M))); break;
   case 'devol': rows.push(r('Resta costo de',on),r('Monto',clp(c.M)),r('Caja','entra '+clp(c.M))); break;
   case 'nopago': rows.push(r('Pérdida de margen (neto)',clp(c.neto)),r('Obra',on),r('IVA','no aplica: nunca se facturó'),r('Caja','no se mueve')); break;
   case 'retiro': rows.push(r('Resultado','no afecta'),r('Caja','sale '+clp(c.M)),r('Plata libre hoy',clp(libre))); if(c.M>Math.max(0,libre)) W.push(`<p class="note bad">Este retiro es mayor que la plata libre (${clp(libre)}). Se estaría usando plata comprometida en obras, IVA o Casa Construcción.</p>`); break;
   case 'f29': rows.push(r('Resultado','no afecta (el IVA no es costo)'),r('Caja','sale '+clp(c.M))); break;
   case 'cuota': rows.push(r('Capital (no afecta resultado)',clp(c.M-c.interes)),r('Intereses (gasto financiero)',clp(c.interes)),r('Caja','sale '+clp(c.M))); break;
   case 'traspaso': rows.push(r('Resultado','no afecta'),r('Caja total','no cambia')); break;
  }
  $('#eff').innerHTML=rows.join('');
  if(['pago','socio','cobro'].includes(c.t)&&F.doc==='Nada'&&!F.adj&&c.M) W.push('<p class="note">Sin documento: adjunta una foto o PDF del respaldo. Si no, queda marcado como "sin respaldo".</p>');
  if(['pago','socio'].includes(c.t)&&F.doc==='Boleta de honorarios') W.push(F.ret==='emisor'?'<p class="note">Retiene el emisor: se registra el total, sin deuda con el SII.</p>':'<p class="note">Se crean 2 movimientos: el pago al profesional (líquido) y la retención por pagar al SII, que queda pendiente hasta que pagues el F29.</p>');
  if(F.ndoc&&F.prov){const dup=D.movs.find(m=>(m.quien||'').toLowerCase()===F.prov.toLowerCase().trim()&&String(m.ndoc)===String(F.ndoc).trim()); if(dup) W.push(`<p class="note bad">Posible duplicado: ya existe ${esc(dup.quien)} N° ${esc(dup.ndoc)} por ${clp(dup.total)} (${fdate(dup.fecha)}). Si la factura se reparte entre obras, confirma y guarda.</p>`);}
  if(c.M){const sim=D.movs.find(m=>m.total===c.M&&(m.quien||'').toLowerCase()===F.prov.toLowerCase().trim()); if(sim&&!(F.ndoc&&String(sim.ndoc)===String(F.ndoc))) W.push(`<p class="note">Ya hay un movimiento de ${esc(sim.quien)} por el mismo monto (${fdate(sim.fecha)}). Revisa que no sea el mismo.</p>`);}
  $('#warns').innerHTML=W.join('');
}
const NAT_T={cobro:['Venta','Cobro a cliente'],reemb:['Recupero','Reembolso de cliente'],devol:['Recupero','Devolución de proveedor'],nopago:['Pérdida','Monto no pagado por cliente'],retiro:['No afecta','Retiro de socio'],f29:['No afecta','Pago F29 (IVA)'],cuota:['No afecta','Cuota de crédito'],traspaso:['No afecta','Traspaso entre cuentas'],reembsocio:['No afecta','Traspaso / pagado por socios']};
let GUARDANDO=false;
async function guardar(c,t){
  if(GUARDANDO) return; GUARDANDO=true; $('#save')&&($('#save').disabled=true);
  try{
  const ing=['cobro','reemb','devol'].includes(F.tipo);
  const [nat,cuenta]=NAT_T[F.tipo]||[c.nat,c.cuenta];
  const pag=['pago','cobro','reemb'].includes(F.tipo)?F.pagado:(F.tipo!=='socio');
  const unO=c.o?c.o.un:null;
  const medio=F.tipo==='socio'?'Cuenta personal socio':(F.tipo==='nopago'?null:F.medio);
  const base={fecha:F.fecha||null,tipo:ing?'ingreso':'egreso',quien:(F.prov||(F.tipo==='retiro'||F.tipo==='reembsocio'||F.tipo==='socio'?F.socio:t.t)).trim(),total:c.M,neto:F.tipo==='nopago'?c.neto:(['pago','cobro','socio'].includes(F.tipo)?c.neto:c.M),iva:F.tipo==='nopago'?0:c.iva,doc:t.doc?F.doc:'Nada',ndoc:F.ndoc||null,pagado:F.tipo==='socio'?true:pag,detalle:F.detalle||null,estado_doc:t.doc?(F.edoc||(F.doc==='Nada'?'no_aplica':'ok')):'no_aplica',nat,cuenta,un:['Venta','Costo directo','Recupero','Pérdida'].includes(nat)?unO:null,obra_id:c.o?c.o.id:null,medio,liga:F.liga||null};
  if(F.tipo==='cuota'&&c.interes){base.neto=c.M-c.interes;}
  if(c.ret){base.neto=c.M; base.detalle=(base.detalle?base.detalle+' · ':'')+'líquido de boleta de honorarios (bruto '+clp(c.neto)+')';}
  let id; const extra=[];
  if(EDIT){await api.actualizar('movimientos',EDIT,base); id=EDIT;}
  else {id=(await api.insertar('movimientos',base))[0].id;}
  const nuevos=[];
  if(F.tipo==='cuota'&&c.interes&&!EDIT) nuevos.push({fecha:base.fecha,tipo:'egreso',quien:base.quien,total:c.interes,neto:c.interes,iva:0,doc:'Nada',pagado:true,detalle:'Intereses de la cuota '+id,nat:'Financiero',cuenta:'Comisiones e intereses',medio:base.medio,liga:id});
  if(F.tipo==='cuota'&&c.interes&&!EDIT){await api.actualizar('movimientos',id,{total:c.M-c.interes});}
  if(F.tipo==='cobro'&&c.com&&!EDIT){nuevos.push({fecha:base.fecha,tipo:'egreso',quien:'Transbank',total:c.com,neto:c.com,iva:0,doc:'Nada',pagado:pag,detalle:'Comisión descontada del cobro '+id,nat:'Costo directo',cuenta:'Comisión de cobro',un:unO,obra_id:base.obra_id,medio:F.medio,liga:id}); extra.push('comisión '+clp(c.com));}
  if(c.tc&&!ing&&!EDIT){const soc=F.tipo==='socio'?F.socio:(F.medio==='TC de la casa'?'TC de la casa':F.socio);
    if(F.tipo!=='socio') await api.actualizar('movimientos',id,{pagado:true});
    nuevos.push({fecha:base.fecha,tipo:'egreso',quien:soc,total:c.M,neto:c.M,iva:0,doc:'Nada',pagado:false,detalle:'Devolver a '+soc+' lo que pagó a '+(base.quien||'—')+' ('+id+')',nat:'No afecta',cuenta:'Traspaso / pagado por socios',liga:id}); extra.push('deuda con '+soc);}
  if(c.ret&&!EDIT) nuevos.push({fecha:base.fecha,tipo:'egreso',quien:'SII · retención honorarios',total:c.ret,neto:c.ret,iva:0,doc:'Nada',pagado:false,detalle:'Retención 15,25% de la boleta de '+base.quien+(base.ndoc?' N° '+base.ndoc:'')+' ('+id+'). Se paga en el F29.',nat:base.nat,cuenta:base.cuenta,un:base.un,obra_id:base.obra_id,liga:id});
  if(F.tipo==='f29'&&!EDIT){const rets=D.movs.filter(m=>!m.pagado&&m.quien==='SII · retención honorarios'&&(m.fecha||'')<base.fecha); for(const m of rets) await api.actualizar('movimientos',m.id,{pagado:true,medio:'Pagado en el F29',detalle:(m.detalle||'')+' · pagada con '+id}); if(rets.length) extra.push(rets.length+' retención(es) de honorarios marcadas como pagadas');}
  if(nuevos.length) await api.insertar('movimientos',nuevos);
  if(F.tipo==='reembsocio'&&F.liga&&!EDIT){await api.actualizar('movimientos',F.liga,{pagado:true,fecha:base.fecha,detalle:((movById(F.liga)||{}).detalle||'')+' · devuelto con '+id}); extra.push(F.liga+' saldado');}
  toast((EDIT?'Corregido ':'Guardado ')+id+(extra.length?' + '+extra.join(', '):''));
  EDIT=null; F={...F,prov:'',ndoc:'',monto:'',interes:'',adj:false,cuenta:'',llego:'',detalle:'',liga:'',pagado:true,edoc:''};
  await reload('nuevo');
  }catch(e){console.error(e); toast('No se pudo guardar: '+(e.message||e));}
  finally{GUARDANDO=false;}
}
function toast(msg){document.querySelectorAll('.toast').forEach(x=>x.remove());const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600)}

/* =========================================================
   MÓDULOS NUEVOS: detalle de movimiento, cierre de obra,
   cotizador, proveedores, clientes, socios, impuestos,
   conciliación y reporte para Max
   ========================================================= */
const isMax=()=>!ME||ME.rol!=='admin';
const movById=id=>D.movs.find(m=>m.id===id);
const obraDe=m=>obrasAll.find(o=>o.id===m.obra_id);
function efectoMov(m){
  const on=esc(m.obra_n||'—');
  switch(m.nat){
    case 'Venta': return [['Venta neta de '+on,clp(m.neto)],['IVA débito',clp(m.iva)],['Caja',m.pagado?'entró '+clp(m.total):'por cobrar '+clp(m.total)]];
    case 'Costo directo': return [['Costo de '+on,clp(m.neto)],['IVA crédito',m.iva?clp(m.iva):'$0'],['Caja',m.pagado?'salió '+clp(m.total):'por pagar '+clp(m.total)]];
    case 'Recupero': return [['Resta costo de '+on,clp(m.total)],['Caja',m.pagado?'entró '+clp(m.total):'por recibir']];
    case 'Pérdida': return [['Pérdida en '+on,clp(m.neto)],['Caja','no se mueve']];
    case 'Estructura': return [['Gasto general del mes',clp(m.neto)],['IVA crédito',m.iva?clp(m.iva):'$0'],['Caja',m.pagado?'salió '+clp(m.total):'por pagar']];
    case 'Financiero': return [['Gasto financiero',clp(m.neto)],['Caja','salió '+clp(m.total)]];
    default: return [['Resultado','no afecta'],['Caja',(m.tipo==='ingreso'?'entró ':'salió ')+clp(m.total)+(m.pagado?'':' (pendiente)')]];
  }
}
function movDlg(id){
  let m=movById(id);
  if(!m){const p=C.pend_pagos.find(x=>x.id===id); if(!p) return; m={id,fecha:p.fecha,tipo:'egreso',quien:p.quien,total:p.total,neto:p.total,iva:0,doc:'—',ndoc:'',pagado:false,detalle:p.detalle,nat:'—',cuenta:'—',obra_n:p.obra};}
  const bk=(D.banco||[]).find(b=>b.movs.includes(id));
  const o=obraDe(m);
  $('#dlgT').innerHTML=`<h2 style="margin:0">${esc(m.quien||'—')} <span class="num" style="font-weight:500">${m.tipo==='ingreso'?'+':'−'}${clp(m.total)}</span></h2><div class="row"><span class="chip">${esc(m.cuenta)}</span>${m.pagado?'<span class="chip open">'+'Pagado'+'</span>':'<span class="chip warn">Pendiente</span>'}<small class="sub" style="margin:0">${m.id}</small></div>`;
  $('#dlgB').innerHTML=`<dl class="dl">
    <dt>Fecha</dt><dd>${m.fecha?fdate(m.fecha)+' '+m.fecha.slice(0,4):'<span class="negc">sin fecha</span>'}</dd>
    <dt>Obra</dt><dd>${o?`<a href="#" data-obra="${o.id}">${esc(m.obra_n)}</a>`:esc(m.obra_n)}</dd>
    <dt>Naturaleza</dt><dd>${esc(m.nat)} · ${esc(m.cuenta)}</dd>
    <dt>Medio</dt><dd>${esc(m.medio||'—')}</dd>
    <dt>Documento</dt><dd>${esc(m.doc)}${m.ndoc?' N° '+esc(m.ndoc):''} · <b>${EDOC(m)}</b>${['falta','por_emitir'].includes(m.estado_doc)?` <button class="x solo-ros" type="button" data-act="doc-ok" data-id="${m.id}">Marcar ${m.tipo==='ingreso'?'enviada':'recibido'}</button>`:''}</dd>
    <dt>Neto / IVA</dt><dd class="num">${clp(m.neto)} / ${clp(m.iva)}</dd>
    <dt>Detalle</dt><dd>${esc(m.detalle||'—')}</dd>
    ${(()=>{const l=m.liga&&m.liga!==m.id?movById(m.liga):null; const hijos=D.movs.filter(x=>x.liga===m.id&&x.id!==m.id); return (l?`<dt>Ligado a</dt><dd><a href="#" data-mov="${l.id}">${l.id} · ${esc(l.quien)} ${clp(l.total)}</a> <small class="sub">(${esc(l.obra_n)})</small></dd>`:'')+(hijos.length?`<dt>Relacionados</dt><dd>${hijos.map(h=>`<a href="#" data-mov="${h.id}">${h.id} · ${esc(h.quien)} ${clp(h.total)}</a>`).join('<br>')}</dd>`:'');})()}
    <dt>Banco</dt><dd>${bk?`<span class="pos">✓ Cuadra con la cartola</span> cta ${bk.cuenta} del ${fdate(bk.fecha)} (${esc(bk.desc)})`:m.pagado?'<small>sin cartola cargada para esa fecha</small>':'<small>todavía no sale del banco</small>'}</dd>
  </dl>
  <div><h3>Cómo afecta</h3><div class="effect">${efectoMov(m).map(([a,b])=>`<div><span>${a}</span><b class="num">${b}</b></div>`).join('')}</div></div>
  <div class="row solo-ros noprint">
    ${!m.pagado?`<label style="flex:1;min-width:150px">Fecha de pago<input type="date" id="mp_f" value="${HOY}"></label><label style="flex:1;min-width:180px">${m.tipo==='ingreso'?'Entró a':'Desde'}<select id="mp_c">${MEDIOS.map(x=>`<option ${m.medio===x?'selected':''}>${x}</option>`).join('')}</select></label><button class="btn" type="button" data-act="pagar" data-id="${m.id}">Marcar pagado</button>`:''}
    <button class="btn ghost" type="button" data-act="editar" data-id="${m.id}">Corregir</button>
    <button class="x" type="button" data-act="anular" data-id="${m.id}">Anular</button>
    ${m.tipo==='egreso'&&m.nat==='Costo directo'?`<button class="btn ghost" type="button" data-act="devol" data-id="${m.id}">Registrar devolución</button>`:''}
  </div>
  <div id="hist"></div>
  <p class="help">Corregir no borra: guarda la versión anterior en el historial. Anular lo saca de los números sin borrarlo.</p>`;
  api.historial(m.id).then(H=>{const el=$('#hist'); if(el&&H.length) el.innerHTML=`<h3>Historial</h3><ul class="check">${H.map(h=>`<li><i>·</i><div><small>${new Date(h.cuando).toLocaleString('es-CL')} · antes: ${esc(h.antes.quien||'')} ${clp(h.antes.total)} · ${esc(h.antes.cuenta)} · ${h.antes.pagado?'pagado':'pendiente'} · ${fdate(h.antes.fecha)}</small></div></li>`).join('')}</ul>`;}).catch(()=>{});
  if(!$('#dlg').open) $('#dlg').showModal();
}
async function marcarPagado(id){
  const m=movById(id); const f=$('#mp_f').value; const medio=$('#mp_c').value;
  try{ await api.actualizar('movimientos',id,{pagado:true,fecha:f,medio});
    $('#dlg').close(); await reload(); toast('Marcado como pagado. Plata libre: '+clp(libre));
  }catch(e){toast('No se pudo: '+(e.message||e));}
}
async function anularMov(id){
  if(!confirm('¿Anular '+id+'? Deja de contar en todos los números, pero queda en el historial.')) return;
  try{ await api.actualizar('movimientos',id,{anulado:true}); $('#dlg').close(); await reload(); toast(id+' anulado'); }catch(e){toast('No se pudo: '+(e.message||e));}
}
const MEDIOS=['Cuenta 159-46332-07','Cuenta 159-74413-10','Reserva F29 (cuenta Rosario)','TC de la casa','Cuenta personal socio'];
const TIPO_DE={'Venta':'cobro','Costo directo':'pago','Estructura':'pago','Financiero':'pago','Recupero':'reemb','Pérdida':'nopago'};
let EDIT=null;
function editarMov(id){
  const m=movById(id); if(!m) return; EDIT=id;
  const o=obraDe(m);
  F={...F,socio:/max/i.test(m.quien||'')?'Max':'Rosario',tipo:m.medio==='Cuenta personal socio'&&m.tipo==='egreso'?'socio':(m.cuenta==='Traspaso / pagado por socios'&&m.tipo==='egreso')?'reembsocio':TIPO_DE[m.nat]||(m.cuenta==='Retiro de socio'?'retiro':m.cuenta==='Pago F29 (IVA)'?'f29':m.cuenta==='Cuota de crédito'?'cuota':'traspaso'),prov:m.quien||'',obra:o?o.id:'',doc:['Nada','Factura','Boleta','Boleta de honorarios'].includes(m.doc)?m.doc:'Nada',ret:'hh',edoc:m.estado_doc||'',ndoc:m.ndoc||'',monto:String(m.total),fecha:m.fecha||HOY,cuenta:F.tipo==='pago'?'':'',pagado:m.pagado,llego:'',medio:m.medio||F.medio,detalle:m.detalle||'',liga:m.liga||''};
  if(['pago','socio'].includes(F.tipo)) F.cuenta=m.cuenta;
  $('#dlg').close(); show('nuevo');
}
function devolMov(id){
  const m=movById(id); const o=obraDe(m); EDIT=null;
  F={...F,tipo:'devol',prov:m.quien||'',obra:o?o.id:'',monto:'',ndoc:'',detalle:'Devolución ligada a '+id,liga:id};
  $('#dlg').close(); show('nuevo');
}

/* ---------- cierre de obra ---------- */
function cierre(id){
  const o=obrasAll.find(x=>x.id===id); if(!o) return;
  const pend=C.pend_pagos.filter(p=>p.obra===o.nombre);
  const margenReal=o.pres_neto-o.costo_real-(o.perdida||0);
  const ccReal=o.un==='Construcción'?Math.max(0,Math.round(margenReal*0.5)):0;
  const gastoPct=o.costo_est?o.costo_real/o.costo_est*100:null;
  const items=[
    [o.por_cobrar<=0,'Pagado completo',o.por_cobrar<=0?`Presupuesto ${clp(o.pres_total)} = pagado por el cliente ${clp(o.cobrado_total)}.`:`Faltan ${clp(o.por_cobrar)} (con IVA). Registra el cobro o declara el «monto no pagado por el cliente».`,o.por_cobrar>0?`<button class="btn ghost" type="button" data-act="ir-cobro" data-id="${o.id}">Registrar cobro</button> <button class="btn ghost" type="button" data-act="ir-nopago" data-id="${o.id}">Declarar no pagado</button>`:''],
    [pend.length===0,'Sin pagos pendientes de la obra',pend.length?pend.map(p=>`${esc(p.quien)} ${clp(p.total)}`).join(' · '):'Todos los proveedores de la obra están pagados.',''],
    [gastoPct==null||gastoPct>=75,'Costos completos',gastoPct==null?'No había costo estimado.':`El gasto real es ${pct(gastoPct)} del estimado (${clp(o.costo_real)} de ${clp(o.costo_est)}). ${gastoPct<75?'Es bastante menos de lo esperado: ¿falta registrar algún costo (mano de obra, pasto, flete)? Si está completo, confírmalo.':''}`,gastoPct!=null&&gastoPct<75?'<label class="row" style="gap:6px;font-weight:500"><input type="checkbox" id="ci_ok" style="width:auto"> Sí, están todos los costos</label>':''],
  ];
  if(o.un==='Construcción') items.push([ccReal-o.cc_pagado<=0,'Casa Construcción liquidada',`50% del margen real = ${clp(ccReal)} · pagado ${clp(o.cc_pagado)} · ${ccReal-o.cc_pagado>0?'falta pagar '+clp(ccReal-o.cc_pagado):'al día'}.`,'']);
  $('#dlgT').innerHTML=`<h2 style="margin:0">Cerrar obra: ${esc(o.nombre)}</h2><small class="sub" style="margin:0">Al cerrar, la ficha queda fija y pasa al historial del cotizador.</small>`;
  $('#dlgB').innerHTML=`<ul class="check">${items.map(([ok,t,d,b])=>`<li class="${ok?'ok':'no'}"><i>${ok?'✓':'✕'}</i><div><b>${t}</b><br><small>${d}</small>${b?`<div class="row" style="margin-top:6px">${b}</div>`:''}</div></li>`).join('')}</ul>
  <div class="grid g4">
   <div class="kpi"><span>Venta neta</span><b>${clp(o.pres_neto)}</b></div>
   <div class="kpi"><span>Costo directo real</span><b>${clp(o.costo_real)}</b></div>
   <div class="kpi"><span>Margen real</span><b class="${margenReal>=0?'pos':'negc'}">${clp(margenReal)}</b><small>${pct(o.pres_neto?margenReal/o.pres_neto*100:0)} · proyectado era ${pct(o.margen_pct)}</small></div>
   <div class="kpi"><span>Queda para HH</span><b>${clp(margenReal-ccReal)}</b></div>
  </div>
  <div class="form">
   <label>Cantidad (para el cotizador)<input id="ci_q" inputmode="decimal" placeholder="Ej: 85"></label>
   <label>Unidad<select id="ci_u"><option>m²</option><option>m lineal</option><option>mes</option><option>global</option></select></label>
   <label>Días de obra<input id="ci_d" inputmode="numeric" placeholder="Ej: 6"></label>
  </div>
  <label>Aprendizajes (qué saldría distinto la próxima vez)<textarea id="ci_a" rows="3" placeholder="Ej: el flete del pasto lo cobra aparte Grillo; considerar 1 día más de instalación en azoteas."></textarea></label>
  <div class="row"><button class="btn" type="button" id="ci_go" data-act="cerrar" data-id="${o.id}">Cerrar obra</button><small class="sub" id="ci_msg" style="margin:0"></small></div>`;
  const upd=()=>{if(!$('#ci_go')) return; const ok=items.every(([k],i)=>k||(i===2&&$('#ci_ok')&&$('#ci_ok').checked)); $('#ci_go').disabled=!ok; $('#ci_msg').textContent=ok?'':'Se habilita cuando todo esté en ✓.';};
  $('#dlgB').addEventListener('change',upd); upd();
  if(!$('#dlg').open) $('#dlg').showModal();
}
async function cerrarObra(id){
  const cierre={q:+($('#ci_q').value.replace(',','.'))||null,u:$('#ci_u').value,dias:+$('#ci_d').value||null,apr:$('#ci_a').value,fecha:HOY};
  try{ await api.actualizar('obras',id,{estado:'cerrada',cierre}); $('#dlg').close(); await reload('obras'); toast('Obra cerrada. Su ficha ya aparece en el cotizador.'); }catch(e){toast('No se pudo: '+(e.message||e));}
}

/* ---------- cotizador ---------- */
const PARTIDAS=['Materiales','Subcontrato / mano de obra','Fletes y traslados','Retiro de escombros','Arriendo equipos y herramientas','Viáticos'];
const COT=[]; let Q={cliente:'',nombre:'',un:'Pasto',q:'',u:'m²',p:{},mg:''};
function histUn(un){
  const L=obras.filter(o=>!o.abierta&&!noCuadrada(o)&&o.un===un&&o.pres_neto>0);
  const v=sum(L.map(o=>o.pres_neto)), mg=sum(L.map(o=>o.margen));
  return {L,mgPct:v?mg/v*100:null};
}
V.cotizar=()=>{
  const H=histUn(Q.un);
  return `<div><h1>Cotizar</h1><p class="sub">Partes del costo y la app calcula el precio con el margen que elijas, comparándolo con lo que realmente dejaron obras parecidas. Al aprobarse, la cotización se convierte en obra en curso con su costo estimado.</p></div>
  <div class="grid g2">
  <section class="card"><h2>Nueva cotización</h2><div class="form" id="qf">
    <label>Cliente<input data-q="cliente" value="${esc(Q.cliente)}" list="clis"><datalist id="clis">${[...new Set(obras.map(o=>o.cliente).filter(Boolean))].map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
    <label>Nombre de la obra<input data-q="nombre" value="${esc(Q.nombre)}" placeholder="Ej: Pasto patio Las Condes"></label>
    <label>Unidad de negocio<select data-q="un">${['Pasto','Construcción','Aseo'].map(u=>`<option ${Q.un===u?'selected':''}>${u}</option>`).join('')}</select></label>
    <label>Cantidad<span class="row" style="flex-wrap:nowrap"><input data-q="q" inputmode="decimal" value="${esc(Q.q)}" placeholder="85"><select data-q="u" style="width:auto">${['m²','m lineal','mes','global'].map(u=>`<option ${Q.u===u?'selected':''}>${u}</option>`).join('')}</select></span></label>
    ${PARTIDAS.map(p=>`<label>${p} <small>(neto)</small><input data-qp="${p}" inputmode="numeric" value="${esc(Q.p[p]||'')}"></label>`).join('')}
    <label>Margen que quieres <small>(% sobre la venta)</small><input data-q="mg" inputmode="decimal" value="${esc(Q.mg)}" placeholder="${H.mgPct!=null?Math.round(H.mgPct):30}"></label>
  </div></section>
  <section class="card"><h2>Precio</h2><div class="effect" id="qr"></div><div id="qw" style="display:grid;gap:8px;margin-top:10px"></div>
   <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="q-save">Guardar cotización</button></div></section>
  </div>
  <section class="card"><h2>Obras ${Q.un.toLowerCase()} anteriores (cerradas y cuadradas)</h2>${H.L.length?`<div class="tbl"><table><thead><tr><th>Obra</th><th class="n">Venta neta</th><th class="n">Costo</th><th class="n">Margen</th><th class="n">Materiales</th><th class="n">Mano de obra</th><th>Cantidad</th></tr></thead><tbody>
   ${H.L.map(o=>{const c=o.cuentas||{};const ct=o.costo_real||1;return `<tr class="click" data-obra="${o.id}"><td>${esc(o.nombre)}</td><td class="n">${clp(o.pres_neto)}</td><td class="n">${clp(o.costo_real)}</td><td class="n ${o.margen>=0?'':'negc'}">${pct(o.margen_pct)}</td><td class="n">${pct((c['Materiales']||0)/ct*100)}</td><td class="n">${pct((c['Subcontrato / mano de obra']||0)/ct*100)}</td><td>${o.cierre&&o.cierre.q?o.cierre.q+' '+o.cierre.u+' · '+clp(o.pres_neto/o.cierre.q)+'/'+o.cierre.u:'<small>sin dato</small>'}</td></tr>`}).join('')}
   <tr class="tot"><td>Margen promedio</td><td></td><td></td><td class="n">${pct(H.mgPct)}</td><td colspan="3"></td></tr></tbody></table></div>`:'<p class="sub">Aún no hay obras cerradas de esta unidad.</p>'}
   <p class="help">La columna «Cantidad» se llena al cerrar cada obra (m², meses…). Con eso el cotizador sugiere precio por m² con costos reales. Hoy ninguna obra antigua tiene ese dato.</p></section>
  <section class="card"><h2>Cotizaciones</h2>${COT.length?`<div class="tbl"><table><thead><tr><th>Obra</th><th>Cliente</th><th class="n">Precio neto</th><th class="n">Margen</th><th>Estado</th><th></th></tr></thead><tbody>${COT.map((c,i)=>`<tr><td>${esc(c.nombre)}<br><span class="chip ${c.un}">${c.un}</span></td><td>${esc(c.cliente)}</td><td class="n">${clp(c.neto)}</td><td class="n">${pct(c.mg)}</td><td><span class="chip ${c.estado==='Aprobada'?'open':c.estado==='Rechazada'?'bad':'warn'}">${c.estado}</span></td><td>${c.estado==='Enviada'?`<button class="btn ghost" type="button" data-act="q-ok" data-id="${i}">Aprobar → obra</button> <button class="x" type="button" data-act="q-no" data-id="${i}">Rechazada</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="sub">Todavía no hay cotizaciones. La app actual tiene la tabla vacía, así que aquí parten de cero.</p>'}</section>`;
};
function qCalc(){
  const H=histUn(Q.un); const costo=sum(PARTIDAS.map(p=>+String(Q.p[p]||'').replace(/\D/g,'')||0));
  const mg=(Q.mg!==''?+String(Q.mg).replace(',','.'):(H.mgPct!=null?Math.round(H.mgPct):30));
  const neto=mg<100?Math.round(costo/(1-mg/100)):0; const iva=Math.round(neto*0.19);
  const margen=neto-costo; const cc=Q.un==='Construcción'?Math.round(margen*0.5):0;
  return {H,costo,mg,neto,iva,margen,cc,q:+String(Q.q).replace(',','.')||0};
}
function qRender(){
  const c=qCalc(); const r=(a,b)=>`<div><span>${a}</span><b class="num">${b}</b></div>`;
  $('#qr').innerHTML=[r('Costo directo estimado',clp(c.costo)),r('Margen '+pct(c.mg),clp(c.margen)),r('<b>Precio neto</b>','<b>'+clp(c.neto)+'</b>'),r('IVA',clp(c.iva)),r('Total con IVA',clp(c.neto+c.iva)),
    c.q?r('Precio por '+Q.u,clp(c.neto/c.q)+' neto'):'',Q.un==='Construcción'?r('Casa Construcción (50% del margen)',clp(c.cc)):'',r('Queda para Happy Home',clp(c.margen-c.cc)),
    r('Cubre de gastos generales',C.estructura_prom?(Math.round((c.margen-c.cc)/C.estructura_prom*30))+' días':'—')].join('');
  const W=[];
  if(c.H.mgPct!=null&&c.mg<c.H.mgPct-5) W.push(`<p class="note">El margen que pusiste (${pct(c.mg)}) está bajo el promedio real de ${Q.un.toLowerCase()} (${pct(c.H.mgPct)}).</p>`);
  if(c.costo&&!+String(Q.p['Subcontrato / mano de obra']||'').replace(/\D/g,'')) W.push('<p class="note">No pusiste mano de obra. Si la hace un subcontratista, inclúyela.</p>');
  if(Q.un==='Construcción'&&c.mg<20) W.push('<p class="note bad">En construcción la mitad del margen es de Casa Construcción: con menos de 20% a Happy Home le queda muy poco.</p>');
  $('#qw').innerHTML=W.join('');
}
async function qSave(){
  const c=qCalc(); if(!c.costo||!Q.nombre){toast('Falta el nombre o algún costo');return;}
  try{ await api.insertar('cotizaciones',{cliente:Q.cliente,nombre:Q.nombre,un:Q.un,cantidad:c.q||null,unidad:Q.u,partidas:Q.p,margen:c.mg,neto:c.neto,iva:c.iva,estado:'Enviada'});
    Q={cliente:'',nombre:'',un:Q.un,q:'',u:'m²',p:{},mg:''}; await reload('cotizar'); toast('Cotización guardada');
  }catch(e){toast('No se pudo: '+(e.message||e));}
}
async function qAprobar(i){
  const c=COT[i];
  try{ const costo=sum(PARTIDAS.map(p=>+String(c.p[p]||'').replace(/\D/g,'')||0));
    const o=(await api.insertar('obras',{nombre:c.nombre,un:c.un,cliente:c.cliente,estado:'en_curso',inicio:HOY,pres_neto:c.neto,pres_total:c.neto+c.iva,costo_est:costo}))[0];
    await api.actualizar('cotizaciones',c.id,{estado:'Aprobada',obra_id:o.id}); await reload('cotizar'); toast(c.nombre+' ya es una obra en curso ('+o.id+')');
  }catch(e){toast('No se pudo: '+(e.message||e));}
}
async function qRechazar(i){ try{ await api.actualizar('cotizaciones',COT[i].id,{estado:'Rechazada'}); await reload('cotizar'); }catch(e){toast('No se pudo: '+(e.message||e));} }
/* ---------- obra: crear / editar ---------- */
function obraForm(id){
  const o=id?DB.obras.find(x=>x.id===id):{nombre:'',cliente:'',un:'Pasto',pres_total:'',pres_neto:'',costo_est:'',inicio:HOY,notas:''};
  abrir(id?'Editar '+esc(o.nombre):'Nueva obra',`<div class="form" id="of">
   <label>Nombre<input id="o_n" value="${esc(o.nombre)}"></label>
   <label>Cliente<input id="o_c" value="${esc(o.cliente||'')}" list="clis2"><datalist id="clis2">${[...new Set(DB.obras.map(o=>o.cliente).filter(Boolean))].map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
   <label>Unidad<select id="o_u">${['Pasto','Construcción','Aseo'].map(u=>`<option ${o.un===u?'selected':''}>${u}</option>`).join('')}</select></label>
   <label>Inicio<input id="o_i" type="date" value="${o.inicio||''}"></label>
   <label>Presupuesto total con IVA<input id="o_t" inputmode="numeric" value="${o.pres_total?Math.round(o.pres_total):''}"></label>
   <label>Costo directo estimado (sin IVA)<input id="o_e" inputmode="numeric" value="${o.costo_est?Math.round(o.costo_est):''}"></label>
   <label>o margen que quieren ganar (%)<input id="o_m" inputmode="decimal" value="${o.costo_est&&o.pres_neto?Math.round((o.pres_neto-o.costo_est)/o.pres_neto*1000)/10:''}" placeholder="Ej: 25"></label>
  </div><label>Notas<textarea id="o_no" rows="2">${esc(o.notas||'')}</textarea></label>
  <p class="help">El neto se calcula solo (total ÷ 1,19). En contratos de aseo, al facturar un mes nuevo, suma ese mes al presupuesto.</p>
  <div class="row"><button class="btn" type="button" data-act="obra-save" data-id="${id||''}">${id?'Guardar cambios':'Crear obra'}</button></div>`);
  const sync=(src)=>{const t=+($('#o_t').value.replace(/\D/g,''))||0, n=Math.round(t/1.19); if(!n) return;
    if(src==='m'){const m=+($('#o_m').value.replace(',','.'))||0; $('#o_e').value=Math.round(n*(1-m/100));}
    else {const e=+($('#o_e').value.replace(/\D/g,''))||0; $('#o_m').value=e?Math.round((n-e)/n*1000)/10:'';}};
  $('#o_m').addEventListener('input',()=>sync('m')); $('#o_e').addEventListener('input',()=>sync('e')); $('#o_t').addEventListener('input',()=>sync('m'));
}
async function mesSiguiente(id){
  const o=DB.obras.find(x=>x.id===id); if(!o) return;
  const re=new RegExp('('+MESL.join('|')+')','i'); const m=o.nombre.match(re);
  const i=m?MESL.indexOf(m[1].toLowerCase()):-1; const sig=i>=0?MESL[(i+1)%12]:null;
  const nombre=sig?o.nombre.replace(re,sig[0].toUpperCase()+sig.slice(1)):o.nombre+' (mes siguiente)';
  if(DB.obras.some(x=>nrm(x.nombre)===nrm(nombre))){toast('Ya existe '+nombre);return;}
  try{ const n=(await api.insertar('obras',{nombre,un:o.un,cliente:o.cliente,estado:'en_curso',inicio:HOY,pres_neto:o.pres_neto,pres_total:o.pres_total,costo_est:o.costo_est}))[0];
    $('#dlg').close(); await reload('obras'); toast(nombre+' creada ('+n.id+')'); }catch(e){toast('No se pudo: '+(e.message||e));}
}
async function obraSave(id){
  const t=+($('#o_t').value.replace(/\D/g,''))||0;
  const row={nombre:$('#o_n').value.trim(),cliente:$('#o_c').value.trim(),un:$('#o_u').value,inicio:$('#o_i').value||null,pres_total:t,pres_neto:Math.round(t/1.19),costo_est:+($('#o_e').value.replace(/\D/g,''))||0,notas:$('#o_no').value||null};
  if(!row.nombre||!row.cliente){toast('Falta nombre o cliente');return;}
  try{ if(id) await api.actualizar('obras',id,row); else await api.insertar('obras',{...row,estado:'en_curso'});
    $('#dlg').close(); await reload('obras'); toast(id?'Obra actualizada':'Obra creada'); }catch(e){toast('No se pudo: '+(e.message||e));}
}


/* ---------- reparto del mes y cuánto se puede sacar ---------- */
const COLCHON_OBRA=0.10; // colchón para imprevistos: 10% de lo que falta gastar
function repartoObra(o){
  const repCC=o.cc_pagado||0; // sin IVA
  const repHH=sum(D.movs.filter(m=>m.cuenta==='Retiro de socio'&&m.pagado&&m.obra_id===o.id).map(m=>m.total));
  const cobrado=o.cobrado_neto, gastado=o.costo_real;
  const cajaObra=cobrado-gastado-repCC-repHH;
  const faltaGastar=Math.max(0,(o.costo_est||0)-gastado), faltaCobrar=Math.max(0,o.pres_neto-cobrado);
  const necesita=Math.max(0,faltaGastar-faltaCobrar), colchon=Math.round(faltaGastar*COLCHON_OBRA);
  const repartible=Math.max(0,cajaObra-necesita-colchon);
  let cc=0,hh=repartible;
  if(o.un==='Construcción'){const meta=(repCC+repHH+repartible)/2; cc=Math.min(repartible,Math.max(0,Math.round(meta-repCC))); hh=repartible-cc;}
  return {o,repCC,repHH,cobrado,gastado,cajaObra,faltaGastar,faltaCobrar,necesita,colchon,repartible,cc,hh,ccIVA:Math.round(cc*1.19)};
}
V.reparto=()=>{
  const L=obras.filter(o=>o.abierta&&o.pres_neto>0).map(repartoObra);
  const cerradasCC=obras.filter(o=>!o.abierta&&ccPendiente(o)>0);
  const totCCiva=sum(L.map(x=>x.ccIVA))+sum(cerradasCC.map(ccPlata)), totHH=sum(L.map(x=>x.hh));
  const paraCC=libre+ccPend; // la plata libre ya tiene apartado lo de CC
  const fila=(a,b,neg)=>`<tr><td>${a}</td><td class="n ${neg?'negc':''}">${b}</td></tr>`;
  // ¿cuánto puedo sacar? (desde abril)
  const ccPendNeto=sum(obras.map(ccPendiente));
  const generadoHH=tot.mc-ccPendNeto-(tot.e+tot.f);
  const retirado=sum(D.movs.filter(m=>m.cuenta==='Retiro de socio'&&m.pagado&&(m.fecha||'')>='2026-04-01').map(m=>m.total));
  const nm=meses.filter(mm=>mm<HOY.slice(0,7)).length||1;
  const sueldoSost=Math.max(0,Math.round(generadoHH/nm));
  return `<div>${backBtn}<h1>Reparto del mes</h1><p class="sub">Cuánto se puede repartir de cada obra en curso sin dejarla sin plata, y cuánto puede sacar Happy Home. Montos de plata con IVA; el cálculo por obra es sin IVA para que cuadre con el margen.</p></div>
  <section class="card"><div class="grid g4">
   <div class="kpi"><span>Transferir a Casa Construcción</span><b>${clp(totCCiva)}</b><small>con IVA · ${paraCC>=totCCiva?'la caja alcanza':`<span class="negc">la caja alcanza solo para ${clp(Math.max(0,paraCC))}: faltan ${clp(totCCiva-Math.max(0,paraCC))}</span>`}</small></div>
   <div class="kpi"><span>Puede sacar Happy Home</span><b class="${Math.min(totHH,libre)<=0?'negc':'pos'}">${clp(Math.max(0,Math.min(totHH,libre)))}</b><small>según las obras: ${clp(totHH)} · plata libre: ${clp(libre)}</small></div>
   <div class="kpi"><span>Sueldo sostenible (promedio)</span><b>${clp(sueldoSost)}</b><small>al mes, entre los socios, con lo que ha generado HH desde abril</small></div>
   <div class="kpi"><span>Generado vs. retirado desde abril</span><b class="${retirado>generadoHH?'negc':'pos'}">${clp(generadoHH-retirado)}</b><small>generado ${clp(generadoHH)} · retirado ${clp(retirado)}</small></div>
  </div>
  ${libre<0?`<p class="note bad"><b>Hoy no hay plata libre (${clp(libre)}).</b> Aunque las obras digan que hay para repartir, esa plata ya se usó en otras cosas (gastos generales, retiros de meses anteriores, otras obras). Se reparte cuando entren los próximos cobros.</p>`:totHH>libre?`<p class="note">Las obras permiten más de lo que hay en caja: el límite es la plata libre (${clp(libre)}).</p>`:''}</section>
  ${L.map(x=>`<section class="card"><div class="spread"><h2>${esc(x.o.nombre)}</h2><span class="chip ${x.o.un}">${x.o.un}</span></div>
   <div class="grid g2"><div class="tbl"><table><tbody>
    ${fila('Pagado por el cliente (sin IVA)',clp(x.cobrado))}
    ${fila('− Gastado',clp(-x.gastado))}
    ${fila('− Ya repartido a CC (sin IVA)',clp(-x.repCC))}
    ${fila('− Ya retirado por HH',clp(-x.repHH))}
    <tr class="tot"><td>= Plata de la obra sin repartir</td><td class="n">${clp(x.cajaObra)}</td></tr>
    ${fila(`− Para terminar la obra <small>(falta gastar ${clp(x.faltaGastar)}, falta cobrar ${clp(x.faltaCobrar)})</small>`,x.necesita?clp(-x.necesita):'alcanza')}
    ${fila(`− Colchón imprevistos <small>(${Math.round(COLCHON_OBRA*100)}% de lo que falta gastar)</small>`,clp(-x.colchon))}
    <tr class="tot"><td>= Se puede repartir</td><td class="n ${x.repartible>0?'pos':''}">${clp(x.repartible)}</td></tr>
   </tbody></table></div>
   <div class="effect">
    ${x.o.un==='Construcción'?`<div><span>Casa Construcción <small>(${clp(x.cc)} + IVA de su factura)</small></span><b class="num">${clp(x.ccIVA)}</b></div>`:''}
    <div><span>Happy Home</span><b class="num">${clp(x.hh)}</b></div>
    ${x.o.un==='Construcción'?`<p class="help">Se reparte para que los dos queden con lo mismo: hasta hoy CC recibió ${clp(x.repCC)} y HH ${clp(x.repHH)} (sin IVA).</p>`:''}
   </div></div></section>`).join('')}
  ${cerradasCC.length?`<section class="card"><h2>Obras cerradas con participación pendiente</h2><div class="tbl"><table><tbody>${cerradasCC.map(o=>`<tr class="click" data-obra="${o.id}"><td>${esc(o.nombre)}</td><td class="n">${clp(ccPlata(o))} <small>con IVA</small></td></tr>`).join('')}</tbody></table></div><p class="help">Esto ya se le debe a CC: va primero que cualquier reparto nuevo.</p></section>`:''}
  <section class="card"><h2>Reglas</h2><ol class="sub" style="margin:0;padding-left:18px">
   <li>Solo se reparte plata que el cliente ya pagó.</li><li>Primero se guarda lo que la obra necesita para terminarse y un colchón del ${Math.round(COLCHON_OBRA*100)}% de lo que falta gastar.</li>
   <li>En construcción se reparte para que CC y HH queden iguales. A CC se le transfiere con IVA (factura); ese IVA HH lo recupera en el F29.</li>
   <li>HH nunca saca más que la plata libre, que ya deja apartado 1 mes de gastos generales, los pagos pendientes, el IVA y lo que se le debe a CC.</li>
   <li>Al cerrar la obra se ajusta con el margen real.</li></ol>
   <p class="help">Para que un retiro cuente en la obra correcta, al registrarlo elige la obra en el campo "De qué obra".</p></section>`;
};

/* ---------- Más ---------- */
const SUB={reparto:'Reparto del mes',fijos:'Gastos fijos',proveedores:'Proveedores',clientes:'Clientes',socios:'Socios y Casa Construcción',impuestos:'IVA y F29',conciliacion:'Conciliación con el banco',reporte:'Reporte del mes'};
const backBtn='<button class="back noprint" type="button" data-go="mas">← Más</button>';
V.mas=()=>`<div><h1>Más</h1><p class="sub">Lo que no se usa todos los días.</p></div>
 <div class="hub">
  <button type="button" data-go="reparto"><b>Reparto del mes</b><small>Cuánto se puede repartir de cada obra a CC y a HH, y cuánto pueden sacar los socios de sueldo.</small></button>
  <button type="button" data-go="reporte"><b>Reporte del mes</b><small>Una página para Max: cómo fue el mes y qué viene. Se puede imprimir.</small></button>
  <button type="button" data-go="conciliacion"><b>Conciliación con el banco</b><small>Cada línea de la cartola contra la app. ${(D.banco||[]).filter(b=>b.estado!=='falta').length} de ${(D.banco||[]).length} líneas cuadradas.</small></button>
  <button type="button" data-go="fijos"><b>Gastos fijos</b><small>Contador, Previred, Entel, TAG, seguros, créditos: qué se pagó cada mes y qué falta.</small></button>
  <button type="button" data-go="impuestos"><b>IVA y F29</b><small>Débito, crédito y pago de cada mes.</small></button>
  <button type="button" data-go="socios"><b>Socios y Casa Construcción</b><small>Retiros, lo que HH les debe a los socios y la participación de CC.</small></button>
  <button type="button" data-go="proveedores"><b>Proveedores</b><small>Cuánto se le ha comprado a cada uno y su cuenta por defecto.</small></button>
  <button type="button" data-go="clientes"><b>Clientes</b><small>Obras, lo pagado y lo por cobrar de cada cliente.</small></button>
 </div>`;
const normQ=s=>(s||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/^\w/,c=>c.toUpperCase());
let fprov='';
V.proveedores=()=>{
  const G={};
  D.movs.filter(m=>m.tipo==='egreso'&&['Costo directo','Estructura','Financiero'].includes(m.nat)).forEach(m=>{const k=normQ(m.quien); const g=G[k]||(G[k]={k,n:0,t:0,cu:{},ult:'',pend:0,ids:[]}); g.n++; g.t+=m.neto; g.cu[m.cuenta]=(g.cu[m.cuenta]||0)+1; if((m.fecha||'')>g.ult) g.ult=m.fecha; if(!m.pagado) g.pend+=m.total; g.ids.push(m.id);});
  const L=Object.values(G).sort((a,b)=>b.t-a.t); window._PROV=G;
  return `<div>${backBtn}<h1>Proveedores</h1><p class="sub">Compras netas desde abril. La cuenta por defecto es la que más se ha usado: al registrar un pago, la app la propone sola.</p></div>
  <section class="card"><label>Buscar<input id="fprov" value="${esc(fprov)}" placeholder="Nombre"></label><div class="tbl" style="margin-top:10px"><table><thead><tr><th>Proveedor</th><th>Cuenta por defecto</th><th class="n">Movs.</th><th class="n">Comprado (neto)</th><th>Último</th><th class="n">Por pagar</th></tr></thead><tbody id="provT">
  ${L.map(g=>`<tr class="click" data-prov="${esc(g.k)}" data-name="${esc(g.k.toLowerCase())}"><td><b>${esc(g.k)}</b></td><td><small>${esc(Object.entries(g.cu).sort((a,b)=>b[1]-a[1])[0][0])}</small></td><td class="n">${g.n}</td><td class="n">${clp(g.t)}</td><td class="num">${fdate(g.ult)}</td><td class="n ${g.pend?'negc':''}">${g.pend?clp(g.pend):'—'}</td></tr>`).join('')}
  </tbody></table></div><p class="help">Se ven nombres repetidos con distinta escritura (ej. «Casa Construccion» y «Aranda Construccion», «Sodimac» y «Sodimac Las Condes»). En la app nueva cada proveedor existe una sola vez y se elige de la lista, así no se duplica.</p></section>`;
};
function provDlg(k){
  const g=window._PROV[k]; const L=g.ids.map(movById).filter(Boolean);
  abrir(esc(k),`<div class="tbl"><table><thead><tr><th>Fecha</th><th>Obra</th><th>Cuenta</th><th class="n">Total</th></tr></thead><tbody>${L.map(m=>`<tr data-mov="${m.id}"><td class="num">${fdate(m.fecha)}</td><td><small>${esc(m.obra_n)}</small></td><td><small>${esc(m.cuenta)}</small>${m.pagado?'':' <span class="chip warn">Pendiente</span>'}</td><td class="n">${clp(m.total)}</td></tr>`).join('')}</tbody></table></div>`);
}
V.clientes=()=>{
  const G={}; obras.forEach(o=>{const k=o.cliente||'(sin cliente)'; (G[k]=G[k]||[]).push(o);});
  const L=Object.entries(G).sort((a,b)=>sum(b[1].map(o=>o.pres_neto))-sum(a[1].map(o=>o.pres_neto)));
  return `<div>${backBtn}<h1>Clientes</h1><p class="sub">Obras desde abril agrupadas por cliente.</p></div>
  <section class="card"><div class="tbl"><table><thead><tr><th>Cliente</th><th>Obras</th><th class="n">Vendido (neto)</th><th class="n">Margen</th><th class="n">Por cobrar</th><th class="n">No pagado</th></tr></thead><tbody>
  ${L.map(([k,os])=>`<tr><td><b>${esc(k)}</b></td><td>${os.map(o=>`<a href="#" data-obra="${o.id}">${esc(o.nombre)}</a>`).join('<br>')}</td><td class="n">${clp(sum(os.map(o=>o.pres_neto)))}</td><td class="n">${clp(sum(os.map(o=>o.margen)))}</td><td class="n">${clp(sum(os.filter(o=>o.abierta).map(o=>o.por_cobrar)))}</td><td class="n ${sum(os.map(o=>o.perdida||0))?'negc':''}">${sum(os.map(o=>o.perdida||0))?clp(sum(os.map(o=>o.perdida||0))):'—'}</td></tr>`).join('')}
  </tbody></table></div><p class="help">Arquitectura Campanil y Gellona no tienen cliente asignado en la app actual: en la nueva, la obra no se crea sin cliente.</p></section>`;
};
V.socios=()=>{
  const ret=D.movs.filter(m=>m.cuenta==='Retiro de socio');
  const first=q=>normQ(q).split(' ')[0]; const who=[...new Set(ret.map(m=>first(m.quien)))];
  const deuda=D.movs.filter(m=>m.cuenta==='Traspaso / pagado por socios'&&m.tipo==='egreso'&&!m.pagado);
  const puso=D.movs.filter(m=>m.cuenta==='Traspaso / pagado por socios'&&m.tipo==='ingreso');
  const cc=obras.filter(o=>o.un==='Construcción'&&o.pres_neto>0);
  return `<div>${backBtn}<h1>Socios y Casa Construcción</h1></div>
  <div class="grid g2">
  <section class="card"><h2>Happy Home les debe a los socios</h2>${deuda.length?`<div class="tbl"><table><tbody>${deuda.map(m=>`<tr data-mov="${m.id}"><td><b>${esc(m.quien)}</b><br><small>${esc(m.detalle)}</small></td><td class="n">${clp(m.total)}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td class="n">${clp(sum(deuda.map(m=>m.total)))}</td></tr></tbody></table></div>`:'<p class="sub">Nada.</p>'}
   <h3 style="margin-top:14px">Gastos de HH pagados por socios o con la TC de la casa</h3><div class="tbl"><table><tbody>${puso.map(m=>`<tr data-mov="${m.id}"><td class="num">${fdate(m.fecha)}</td><td>${esc(m.quien)}<br><small>${esc((m.detalle||'').slice(0,80))}</small></td><td class="n">${clp(m.total)}</td></tr>`).join('')}</tbody></table></div>
   <p class="help">Cuando un socio paga algo de HH con su plata, se registra como «Gasto pagado por un socio»: el costo va a la obra y la app anota sola la deuda con el socio hasta que se le devuelva.</p></section>
  <section class="card"><h2>Retiros de socios</h2><div class="tbl"><table><thead><tr><th>Fecha</th><th>Socio</th><th class="n">Monto</th></tr></thead><tbody>${ret.map(m=>`<tr data-mov="${m.id}"><td class="num">${fdate(m.fecha)}</td><td>${esc(m.quien)}</td><td class="n">${clp(m.total)}</td></tr>`).join('')}
   ${who.map(w=>`<tr class="tot"><td colspan="2">Total ${esc(w)}</td><td class="n">${clp(sum(ret.filter(m=>first(m.quien)===w).map(m=>m.total)))}</td></tr>`).join('')}</tbody></table></div>
   <p class="help">Plata libre hoy: <b class="num ${libre<0?'negc':''}">${clp(libre)}</b>. Al registrar un retiro mayor, la app avisa.</p></section>
  </div>
  <section class="card"><h2>Casa Construcción: participación por obra</h2><div class="tbl"><table><thead><tr><th>Obra</th><th>Estado</th><th class="n">Margen (sin IVA)</th><th class="n">50% para CC (sin IVA)</th><th class="n">Ya transferido</th><th class="n">Falta transferir (con IVA)</th></tr></thead><tbody>
   ${cc.map(o=>`<tr class="click" data-obra="${o.id}"><td>${esc(o.nombre)}</td><td>${o.abierta?'<span class="chip open">En curso</span>':noCuadrada(o)?'<span class="chip bad">Por cuadrar</span>':'<span class="chip">Cerrada</span>'}</td><td class="n">${clp(o.margen)}</td><td class="n">${clp(o.cc_parte)}</td><td class="n">${clp(o.cc_pagado_total)}</td><td class="n">${ccPendiente(o)?clp(ccPlata(o)):'—'}</td></tr>`).join('')}
   <tr class="tot"><td colspan="5">Total por pagar</td><td class="n">${clp(ccPend)}</td></tr></tbody></table></div>
   <p class="help"><b>Decisión pendiente:</b> en obras en curso, ¿la participación se paga sobre lo que ya pagó el cliente, por estado de pago o al cierre? Hoy se estima sobre lo que ya pagó el cliente.</p></section>`;
};
V.impuestos=()=>{
  const ms=[...meses];
  const row=ms.map(mm=>{const L=D.movs.filter(m=>(m.fecha||'').startsWith(mm));
    const deb=sum(L.filter(m=>m.nat==='Venta'&&m.pagado).map(m=>m.iva)); const cre=sum(L.filter(m=>m.tipo==='egreso'&&['Costo directo','Estructura','Financiero'].includes(m.nat)).map(m=>m.iva));
    const nx=mm.slice(0,5)+String(+mm.slice(5)+1).padStart(2,'0');
    const f29=sum(D.movs.filter(m=>(m.fecha||'').startsWith(nx)&&m.cuenta==='Pago F29 (IVA)').map(m=>m.total));
    return {mm,deb,cre,dif:deb-cre,f29};});
  return `<div>${backBtn}<h1>IVA y F29</h1><p class="sub">IVA de cada mes según lo registrado en la app. El F29 se paga el mes siguiente (hasta el 20). Si el crédito es mayor que el débito, queda remanente a favor para el mes siguiente.</p></div>
  <section class="card"><div class="tbl"><table><thead><tr><th>Mes</th><th class="n">IVA débito (ventas)</th><th class="n">IVA crédito (compras)</th><th class="n">Diferencia</th><th class="n">F29 pagado el mes siguiente</th></tr></thead><tbody>
  ${row.map(r=>`<tr><td>${MES[+r.mm.slice(5)-1]}</td><td class="n">${clp(r.deb)}</td><td class="n">${clp(r.cre)}</td><td class="n ${r.dif<0?'pos':''}">${clp(r.dif)}${r.dif<0?' <small>a favor</small>':''}</td><td class="n">${r.f29?clp(r.f29):'—'}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="note">Las diferencias entre «diferencia» y «F29 pagado» vienen de tres cosas: (1) la app cuenta el IVA el día en que se paga y el SII el día de la factura; (2) remanentes de meses anteriores; (3) facturas que están en el SII y no en la app o al revés. Por eso la app nueva importa el <b>Registro de Compras y Ventas (RCV)</b> del SII y marca las diferencias factura por factura.</p></section>`;
};
let fcon='';
V.conciliacion=()=>{
  const B=D.banco||[]; const n=k=>B.filter(b=>b.estado===k).length;
  const lab={ok:'<span class="chip open">✓ Cuadra</span>',interno:'<span class="chip">Entre cuentas HH</span>',fecha:'<span class="chip warn">Fecha distinta</span>',falta:'<span class="chip bad">Falta en la app</span>'};
  const L=B.filter(b=>!fcon||b.estado===fcon).slice().reverse();
  return `<div>${backBtn}<h1>Conciliación con el banco</h1><p class="sub">Cartolas cargadas de las dos cuentas, línea por línea contra los movimientos de la app. La app propone el match (mismo monto, fecha cercana, mismo nombre; o varias líneas que suman un movimiento) y tú lo confirmas.</p></div>
  <section class="card"><div class="grid g4">
   <div class="kpi"><span>Líneas de la cartola</span><b>${B.length}</b></div>
   <div class="kpi"><span>Cuadran con la app</span><b class="pos">${n('ok')}</b></div>
   <div class="kpi"><span>Traspasos entre cuentas HH</span><b>${n('interno')}</b><small>no van como movimiento</small></div>
   <div class="kpi"><span>Por revisar</span><b class="${n('falta')+n('fecha')?'negc':''}">${n('falta')+n('fecha')}</b><small>${n('falta')+n('fecha')?'':'todo cuadrado'}</small></div>
  </div>
  <div class="row noprint solo-ros" style="margin-top:14px"><button class="btn ghost" type="button" data-act="subir">Subir cartola de octubre (PDF o Excel)</button><button class="btn ghost" type="button" data-act="subir">Importar RCV del SII</button></div></section>
  <section class="card"><div class="seg noprint" style="margin-bottom:10px">${[['','Todas'],['ok','Cuadran'],['interno','Entre cuentas'],['fecha','Fecha distinta'],['falta','Faltan']].map(([k,t])=>`<button type="button" data-fcon="${k}" aria-pressed="${fcon===k}">${t}</button>`).join('')}</div>
  <div class="tbl"><table><thead><tr><th>Fecha</th><th>Cta.</th><th>Cartola</th><th class="n">Monto</th><th>Estado</th><th>En la app</th></tr></thead><tbody>
  ${L.map(b=>`<tr${b.movs.length===1?` data-mov="${b.movs[0]}"`:''}><td class="num">${fdate(b.fecha)}</td><td class="num">${b.cuenta}</td><td><small>${esc(b.desc)}</small></td><td class="n ${b.monto>0?'pos':''}">${b.monto>0?'+':''}${clp(b.monto)}</td><td>${lab[b.estado]}</td><td><small>${b.movs.length>3?`${b.movs.length} movimientos · ${esc((movById(b.movs[0])||{}).obra_n||'')} (${esc((movById(b.movs[0])||{}).cuenta||'')})`:b.movs.map(i=>{const m=movById(i);return m?`${i.slice(-4)} ${esc(m.quien)}`:i}).join('<br>')}${b.estado==='falta'?`<button class="x solo-ros" type="button" data-act="crear" data-b="${B.indexOf(b)}">Crear</button>`:''}</small></td></tr>`).join('')}
  </tbody></table></div>
  <p class="help">Una línea puede calzar con varios movimientos (ej. reembolsos del mismo día) o varias líneas con uno (ej. 3 viajes Uber registrados juntos).</p></section>`;
};
let repM=meses[meses.length-1];
V.reporte=()=>{
  const i=meses.indexOf(repM); const t=mesTot(repM), p=i>0?mesTot(meses[i-1]):null;
  const delta=(a,b)=>b==null?'':`<small class="${a>=b?'pos':'negc'}">${a>=b?'▲':'▼'} ${clp(Math.abs(a-b))} vs ${MES[+meses[i-1].slice(5)-1]}</small>`;
  const open=obras.filter(o=>o.abierta);
  const r=R[repM]; const top=Object.entries(r.estructura).sort((a,b)=>b[1]-a[1]).slice(0,4);
  return `<div class="spread">${isMax()?'':backBtn}<div class="row noprint"><label class="usr">Mes <select id="repM">${meses.map(m=>`<option value="${m}" ${m===repM?'selected':''}>${MES[+m.slice(5)-1]} ${m.slice(0,4)}</option>`).join('')}</select></label><button class="btn ghost" type="button" data-act="print">Imprimir</button></div></div>
  <div><h1>Happy Home · ${['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][+repM.slice(5)-1]} ${repM.slice(0,4)}</h1><p class="sub">Resumen en una página. Los números del mes son base caja; el margen de cada obra se mira en su ficha.</p></div>
  <section class="card"><div class="grid g4">
   <div class="kpi"><span>Ventas netas</span><b>${clp(t.v)}</b>${delta(t.v,p&&p.v)}</div>
   <div class="kpi"><span>Lo que dejaron las obras</span><b>${clp(t.mc)}</b><small>${pct(t.v?t.mc/t.v*100:0)} de las ventas</small></div>
   <div class="kpi"><span>Gastos fijos + financieros</span><b>${clp(t.e+t.f)}</b>${delta(-(t.e+t.f),p&&-(p.e+p.f))}</div>
   <div class="kpi"><span>Ganancia del mes</span><b class="${t.res>=0?'pos':'negc'}">${clp(t.res)}</b>${delta(t.res,p&&p.res)}</div>
  </div></section>
  <div class="grid g2">
   <section class="card"><h2>Caja hoy</h2><div class="effect">
    <div><span>Plata en el banco</span><b class="num">${clp(cajaTotal)}</b></div>
    <div><span>Comprometido (pagos, CC, IVA, 1 mes de gastos fijos)</span><b class="num">${clp(cajaTotal-libre)}</b></div>
    <div><span><b>Plata libre</b></span><b class="num ${libre<0?'negc':'pos'}">${clp(libre)}</b></div>
    <div><span>Por cobrar a clientes</span><b class="num">${clp(porCobrar)}</b></div></div>
    <p class="help">${libre<0?'No hay plata libre para retiros hasta los próximos cobros.':'Se puede retirar hasta la plata libre.'}</p></section>
   <section class="card"><h2>Obras en curso</h2><div class="tbl"><table><tbody>${open.map(o=>`<tr class="click" data-obra="${o.id}"><td>${esc(o.nombre)}</td><td class="n">${clp(o.margen)}<br><small>${pct(o.margen_pct)} proyectado</small></td><td class="n"><small>${o.por_cobrar>0?clp(o.por_cobrar)+' por cobrar':'pagada'}</small></td></tr>`).join('')}</tbody></table></div></section>
  </div>
  <section class="card"><h2>En qué se fueron los gastos fijos</h2><div class="tbl"><table><tbody>${top.map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${clp(v)}</td></tr>`).join('')}</tbody></table></div></section>`;
};


/* ---------- buscador global ---------- */
const montoQ=q=>{const d=q.replace(/[$.\s]/g,''); return /^\d{3,}$/.test(d)?d:null;};
function buscar(q){
  const t=nrm(q.trim()); if(t.length<2) return null; const md=montoQ(q);
  const hitM=m=>{const txt=nrm([m.id,m.quien,m.detalle,m.ndoc,m.cuenta,m.obra_n,m.doc,NATL(m.nat)].join(' ')); return txt.includes(t)||(md&&(String(Math.round(m.total)).includes(md)||String(Math.round(m.neto)).includes(md)));};
  const O=obrasAll.filter(o=>nrm(o.nombre+' '+(o.cliente||'')+' '+o.id).includes(t)||(md&&(String(o.pres_total).includes(md)||String(o.pres_neto).includes(md))));
  const M=D.movs.filter(hitM);
  const C=COT.filter(c=>nrm((c.nombre||'')+' '+(c.cliente||'')).includes(t));
  return {O,M,C};
}
function buscarDlg(q){
  const r=buscar(q); if(!r) return;
  const n=r.O.length+r.M.length+r.C.length;
  $('#dlgT').innerHTML=`<h2 style="margin:0">Buscar</h2><input id="gq2" value="${esc(q)}" style="margin-top:8px" placeholder="Nombre, proveedor, N° de factura, monto…">`;
  const body=()=>{const r=buscar($('#gq2').value)||{O:[],M:[],C:[]}; const n=r.O.length+r.M.length+r.C.length;
   return `<small class="sub">${n} resultado${n===1?'':'s'}</small>
   ${r.O.length?`<div><h3>Obras</h3><div class="tbl"><table><tbody>${r.O.slice(0,20).map(o=>`<tr class="click" data-obra="${o.id}"><td><b>${esc(o.nombre)}</b><br><small class="sub">${esc(o.cliente||'')} · ${o.id}</small></td><td>${o.abierta?'<span class="chip open">En curso</span>':'<span class="chip">Cerrada</span>'}</td><td class="n">${clp(o.pres_total)}<br><small class="sub">presupuesto con IVA</small></td></tr>`).join('')}</tbody></table></div></div>`:''}
   ${r.M.length?`<div><h3>Movimientos${r.M.length>60?' (60 más recientes de '+r.M.length+')':''}</h3><div class="tbl"><table><tbody>${r.M.slice(0,60).map(m=>`<tr data-mov="${m.id}"><td class="num">${fdate(m.fecha)}</td><td><b>${esc(m.quien)}</b><br><small class="sub">${esc(m.obra_n)} · ${esc(m.cuenta)}${m.ndoc?' · N° '+esc(m.ndoc):''}${m.detalle?' · '+esc(m.detalle.slice(0,50)):''}</small></td><td>${m.pagado?'':'<span class="chip warn">Pendiente</span>'}</td><td class="n ${m.tipo==='ingreso'?'pos':''}">${m.tipo==='ingreso'?'+':'−'}${clp(m.total)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
   ${r.C.length?`<div><h3>Cotizaciones</h3><div class="tbl"><table><tbody>${r.C.map(c=>`<tr><td>${esc(c.nombre)}<br><small class="sub">${esc(c.cliente||'')}</small></td><td>${c.estado}</td><td class="n">${clp(c.neto+c.iva)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
   ${!n?'<p class="sub">Nada encontrado. Prueba con parte del nombre, el N° de factura o el monto sin puntos.</p>':''}`;};
  $('#dlgB').innerHTML=body();
  if(!$('#dlg').open) $('#dlg').showModal();
  const i=$('#gq2'); i.focus(); i.setSelectionRange(i.value.length,i.value.length);
  let tm; i.addEventListener('input',()=>{clearTimeout(tm); tm=setTimeout(()=>{$('#dlgB').innerHTML=body();},180);});
}

/* ---------- navegación ---------- */
let cur='inicio';
const TAB_DE=v=>SUB[v]?'mas':v;
function show(v){cur=v;document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-current',b.dataset.v===TAB_DE(v)?'page':'false'));
  $('#app').innerHTML=V[v](); window.scrollTo(0,0);
  if(v==='movs'){movTable(); ['fq','fnat','fobra','fest'].forEach(id=>$('#'+id).addEventListener('input',e=>{({fq:()=>fq=e.target.value,fnat:()=>fnat=e.target.value,fobra:()=>fobra=e.target.value,fest:()=>fest=e.target.value})[id](); movTable();}));}
  if(v==='nuevo'){formHTML(); $('#types').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;F.tipo=b.dataset.t;F.cuenta='';F.liga='';document.querySelectorAll('#types button').forEach(x=>x.setAttribute('aria-pressed',x===b));formHTML();});
    $('#save').addEventListener('click',()=>{const c=calc(); if(!c.M){toast('Falta el monto');return;} const t=TIPOS.find(x=>x.k===F.tipo); if(t.obra==='req'&&!F.obra){toast('Falta elegir la obra');return;} if(c.nat==='Costo directo'&&!F.obra&&(F.tipo==='pago'||F.tipo==='socio')){toast('Falta elegir la obra');return;}
      guardar(c,t);});}
  if(v==='cotizar'){qRender(); $('#qf').addEventListener('input',e=>{const el=e.target; if(el.dataset.q){Q[el.dataset.q]=el.value; if(el.dataset.q==='un'){show('cotizar');return;}} if(el.dataset.qp) Q.p[el.dataset.qp]=el.value; qRender();});}
  if(v==='proveedores') $('#fprov').addEventListener('input',e=>{fprov=e.target.value; const q=fprov.toLowerCase(); document.querySelectorAll('#provT tr').forEach(tr=>tr.hidden=q&&!tr.dataset.name.includes(q));});
  if(v==='obras'){const f=$('#fob'); f.addEventListener('input',()=>{fob=f.value; const pos=f.selectionStart; show('obras'); const g=$('#fob'); g.focus(); g.setSelectionRange(pos,pos);});}
  if(v==='reporte') $('#repM').addEventListener('change',e=>{repM=e.target.value; show('reporte');});
}
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(b){if(b.dataset.v==='nuevo'&&!EDIT&&!F.liga){} show(b.dataset.v);}});
function onClick(e){
  const a=e.target.closest('[data-act]');
  if(a){const id=a.dataset.id; e.preventDefault();
    ({pagar:()=>marcarPagado(id),editar:()=>editarMov(id),devol:()=>devolMov(id),cierre:()=>cierre(id),cerrar:()=>cerrarObra(id),
      'ir-cobro':()=>{EDIT=null;F={...F,tipo:'cobro',obra:id,monto:'',liga:''};$('#dlg').close();show('nuevo');},
      'ir-nopago':()=>{const o=obras.find(x=>x.id===id);EDIT=null;F={...F,tipo:'nopago',obra:id,monto:String(o.por_cobrar),liga:''};$('#dlg').close();show('nuevo');},
      'q-save':qSave,'q-ok':()=>qAprobar(+id),'q-no':()=>qRechazar(+id),anular:()=>anularMov(id),
      rapido:()=>rapido(id),'fijo-reg':()=>fijoRegistrar(+id),
      'mes-sig':()=>mesSiguiente(id),
      'doc-ok':async()=>{try{await api.actualizar('movimientos',id,{estado_doc:'ok'}); const op=$('#dlg').open; if(op) $('#dlg').close(); await reload(); toast('Documento marcado');}catch(e){toast('No se pudo: '+(e.message||e));}},
      'ob-reg':()=>{EDIT=null; F={...F,tipo:a.dataset.t,obra:id,prov:'',monto:'',ndoc:'',detalle:'',liga:'',cuenta:'',llego:'',pagado:true,fecha:HOY}; $('#dlg').close(); show('nuevo'); toast('Registrando en '+((obrasAll.find(o=>o.id===id)||{}).nombre||id));},
      'obra-new':()=>obraForm(null),'obra-edit':()=>obraForm(id),'obra-save':()=>obraSave(id||null),
      'cancel-edit':()=>{EDIT=null;F={...F,prov:'',monto:'',ndoc:'',liga:''};show('nuevo');},
      print:()=>window.print(),
      subir:()=>toast('Por ahora mándame la cartola o el RCV y yo los cargo. La carga directa viene después.'),
      crear:()=>{const b=D.banco[+a.dataset.b];EDIT=null;F={...F,tipo:b.monto>0?'cobro':'pago',prov:b.desc.split(':').pop().trim(),monto:String(Math.abs(b.monto)),fecha:b.fecha,pagado:true,liga:''};show('nuevo');}
    })[a.dataset.act]?.(); return;}
  const g=e.target.closest('[data-go]'); if(g){show(g.dataset.go);return;}
  const k=e.target.closest('[data-k]');if(k){k.dataset.k==='libre'?abrir('Plata libre hoy: de dónde sale',desgloseLibre()):abrir('Por cobrar',desgloseCobrar());return;}
  const fg=e.target.closest('[data-fobr-go]'); if(fg){fobr=fg.dataset.fobrGo;show('obras');return;}
  const fo=e.target.closest('[data-fobr]'); if(fo){fobr=fo.dataset.fobr;show('obras');return;}
  const fc=e.target.closest('[data-fcon]'); if(fc){fcon=fc.dataset.fcon;show('conciliacion');return;}
  const pv=e.target.closest('[data-prov]'); if(pv){provDlg(pv.dataset.prov);return;}
  const mv=e.target.closest('[data-mov]'); if(mv){movDlg(mv.dataset.mov);return;}
  const tr=e.target.closest('[data-obra]');if(tr){e.preventDefault();ficha(tr.dataset.obra);}
}
$('#app').addEventListener('click',onClick);
$('#dlgB').addEventListener('click',onClick);
$('#dlgT').addEventListener('click',onClick);
$('#app').addEventListener('change',e=>{if(e.target.dataset.plan){plan[e.target.dataset.plan].sem=+e.target.value; const y=window.scrollY; show('caja'); window.scrollTo(0,y);}});
$('#dlgX').addEventListener('click',()=>$('#dlg').close());
$('#glosBtn').addEventListener('click',()=>{$('#dlgT').innerHTML='<h2 style="margin:0">Qué significa cada cosa</h2>';$('#dlgB').innerHTML=`<dl class="gl">
<dt>Costo directo</dt><dd>Lo que existe solo porque hay una obra: materiales, subcontratos, fletes, retiro de escombros y la participación de Casa Construcción. Siempre va con obra.</dd>
<dt>Gastos generales (General HH)</dt><dd>Lo que cuesta mantener la empresa aunque no haya obras: contador, Previred, teléfono, vehículo, marketing, patentes.</dd>
<dt>Gastos fijos</dt><dd>Parte de los gastos generales que se repite todos los meses (contador, Previred, Entel, TAG, seguros). Se controlan en Más → Gastos fijos.</dd>
<dt>Margen de contribución</dt><dd>Ventas netas menos costos directos. Es lo que dejan las obras para pagar los gastos generales y ganar.</dd>
<dt>No afecta el resultado</dt><dd>Plata que entra o sale pero no es venta ni costo: retiros de socios, pago del F29 (el IVA es del SII), capital de créditos, traspasos y compra de activos.</dd>
<dt>Plata libre</dt><dd>Lo que hay en el banco menos lo que ya está comprometido: IVA, pagos pendientes, Casa Construcción y un mes de gastos generales. Es lo único que se puede retirar.</dd>
<dt>Sin IVA y con IVA</dt><dd>Márgenes, ventas y costos de obra se miden sin IVA, porque el IVA no es ganancia ni costo: es del SII. Todo lo que es plata que entra o sale (caja, plata libre, pendientes, lo que se le transfiere a CC) se muestra con IVA, que es la plata real. Solo la factura separa IVA (19%).</dd>
<dt>Punto de equilibrio</dt><dd>Venta mensual mínima para no perder: gastos generales del mes ÷ % de margen de contribución.</dd></dl>`;$('#dlg').showModal();});
/* ---------- inicio de sesión ---------- */
async function iniciar(){
  const ses=await api.sesion();
  if(!ses){ $('#appV').hidden=true; $('#loginV').hidden=false; $('#lEmail').focus(); return; }
  ME=ses.perfil; $('#loginV').hidden=true; $('#appV').hidden=false;
  document.body.classList.toggle('max',isMax());
  $('#quien').textContent=ME.nombre+(isMax()?' · solo lectura':'')+' · contraseña';
  if(api.esDemo){ $('#banner').hidden=false; $('#banner').querySelector('p').innerHTML='<b>Modo prueba local.</b> Datos de prueba en memoria.'; }
  try{ await reload(isMax()?'reporte':'inicio'); }catch(e){ $('#app').innerHTML=`<div class="loading">No se pudieron cargar los datos: ${esc(e.message||e)}</div>`; }
}
$('#loginF').addEventListener('submit',async e=>{e.preventDefault(); $('#lErr').textContent='';
  try{ await api.entrar($('#lEmail').value.trim(),$('#lPass').value); await iniciar(); }
  catch(err){ $('#lErr').textContent=/invalid/i.test(err.message)?'Correo o contraseña incorrectos.':(err.message||'No se pudo entrar'); }});
$('#quien').addEventListener('click',()=>{abrir('Cambiar contraseña',`<label>Nueva contraseña (mínimo 10 caracteres)<input id="np1" type="password" autocomplete="new-password"></label><label>Repítela<input id="np2" type="password" autocomplete="new-password"></label><div class="row"><button class="btn" type="button" id="npGo">Guardar</button></div>`);
  $('#npGo').addEventListener('click',async()=>{const a=$('#np1').value,b=$('#np2').value; if(a.length<10){toast('Mínimo 10 caracteres');return;} if(a!==b){toast('No coinciden');return;}
    try{await api.cambiarClave(a); $('#dlg').close(); toast('Contraseña cambiada');}catch(e){toast('No se pudo: '+(e.message||e));}});});
$('#gq').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.value.trim().length>=2){clearTimeout(window._gqt); buscarDlg(e.target.value); e.target.value='';}});
$('#gq').addEventListener('input',e=>{const v=e.target.value; if(v.trim().length>=3){clearTimeout(window._gqt); window._gqt=setTimeout(()=>{buscarDlg(v); e.target.value='';},500);}});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(document.activeElement.tagName)&&!$('#dlg').open){e.preventDefault(); $('#gq').focus();}});
$('#salirBtn').addEventListener('click',async()=>{await api.salir(); location.reload();});
iniciar();
