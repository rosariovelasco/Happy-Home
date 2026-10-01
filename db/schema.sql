-- Happy Home · esquema de la base de datos (Supabase / Postgres)
-- Se ejecuta una sola vez en el SQL Editor de Supabase (o por script).

-- ---------- perfiles (quién puede qué) ----------
create table if not exists perfiles (
  id uuid primary key references auth.users on delete cascade,
  nombre text not null,
  rol text not null default 'lector' check (rol in ('admin','lector'))
);

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from perfiles where id = auth.uid() and rol = 'admin');
$$;

-- ---------- obras / contratos ----------
create sequence if not exists obra_seq start 51;
create table if not exists obras (
  id text primary key default 'HH-' || to_char(now(),'YYYY') || '-' || lpad(nextval('obra_seq')::text,3,'0'),
  nombre text not null,
  un text not null check (un in ('Pasto','Construcción','Aseo')),
  cliente text,
  estado text not null default 'en_curso' check (estado in ('en_curso','cerrada')),
  inicio date,
  pres_neto numeric not null default 0,
  pres_total numeric not null default 0,
  costo_est numeric not null default 0,
  legacy_ids text[] default '{}',
  cierre jsonb,
  notas text,
  creado_en timestamptz default now()
);

-- ---------- movimientos ----------
create sequence if not exists mov_seq start 900;
create table if not exists movimientos (
  id text primary key default 'MOV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('mov_seq')::text,4,'0'),
  fecha date,
  tipo text not null check (tipo in ('ingreso','egreso')),
  quien text,
  total numeric not null default 0,
  neto numeric not null default 0,
  iva numeric not null default 0,
  doc text default 'Nada',
  ndoc text,
  pagado boolean not null default true,
  detalle text,
  nat text not null,          -- Venta · Costo directo · Recupero · Pérdida · Estructura · Financiero · No afecta
  cuenta text not null,
  un text,
  obra_id text references obras(id),
  medio text,                 -- cuenta de banco, TC de la casa, cuenta personal socio
  liga text,                  -- movimiento relacionado (devolución, comisión, deuda con socio)
  adjunto text,
  anulado boolean not null default false,
  creado_por uuid default auth.uid(),
  creado_en timestamptz default now(),
  modificado_en timestamptz
);
create index if not exists mov_fecha on movimientos(fecha);
create index if not exists mov_obra on movimientos(obra_id);

-- historial: cada corrección guarda la versión anterior
create table if not exists movimientos_historial (
  id bigserial primary key,
  mov_id text not null,
  antes jsonb not null,
  quien uuid default auth.uid(),
  cuando timestamptz default now()
);
create or replace function guardar_historial() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into movimientos_historial(mov_id, antes) values (old.id, to_jsonb(old));
  new.modificado_en := now();
  return new;
end $$;
drop trigger if exists trg_hist on movimientos;
create trigger trg_hist before update on movimientos for each row execute function guardar_historial();

-- ---------- saldos de banco (según cartola) ----------
create table if not exists saldos_banco (
  id bigserial primary key,
  cuenta text not null,
  fecha date not null,
  saldo numeric not null
);

-- ---------- líneas de cartola para conciliar ----------
create table if not exists banco_lineas (
  id bigserial primary key,
  fecha date not null,
  cuenta text not null,
  descripcion text,
  monto numeric not null,
  movs text[] default '{}',
  estado text not null default 'falta' check (estado in ('ok','interno','fecha','falta'))
);

-- ---------- cotizaciones ----------
create table if not exists cotizaciones (
  id bigserial primary key,
  cliente text, nombre text, un text, cantidad numeric, unidad text,
  partidas jsonb, margen numeric, neto numeric, iva numeric,
  estado text not null default 'Enviada' check (estado in ('Enviada','Aprobada','Rechazada')),
  obra_id text references obras(id),
  creado_en timestamptz default now()
);

-- ---------- RLS: con sesión iniciada se lee todo; solo admin escribe ----------
do $$ declare t text; begin
  foreach t in array array['obras','movimientos','movimientos_historial','saldos_banco','banco_lineas','cotizaciones','perfiles'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists leer on %I', t);
    execute format('create policy leer on %I for select to authenticated using (true)', t);
    if t <> 'movimientos_historial' and t <> 'perfiles' then
      execute format('drop policy if exists escribir on %I', t);
      execute format('create policy escribir on %I for all to authenticated using (es_admin()) with check (es_admin())', t);
    end if;
  end loop;
end $$;
grant usage on sequence obra_seq, mov_seq to authenticated;
