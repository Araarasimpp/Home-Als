-- Home ALS · 2026-11-21
-- Calendario (vista semanal por horas, como el dashboard de referencia):
-- eventos del equipo (reuniones, pagos, entregas especiales, recordatorios).
-- Solo admin y despachador los ven y los editan.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  nota text check (nota is null or length(nota) <= 500),
  dia date not null,
  hora_inicio time not null,
  hora_fin time not null,
  tipo text not null default 'reunion' check (tipo in ('reunion', 'pago', 'entrega', 'recordatorio')),
  creado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint eventos_horas check (hora_fin > hora_inicio)
);

create index if not exists eventos_dia_idx on public.eventos (dia);

alter table public.eventos enable row level security;

drop policy if exists "eventos: admin y despachador leen" on public.eventos;
create policy "eventos: admin y despachador leen" on public.eventos
  for select to authenticated
  using (public.current_role()::text in ('admin', 'despachador'));

drop policy if exists "eventos: admin y despachador crean" on public.eventos;
create policy "eventos: admin y despachador crean" on public.eventos
  for insert to authenticated
  with check (public.current_role()::text in ('admin', 'despachador'));

drop policy if exists "eventos: admin y despachador cambian" on public.eventos;
create policy "eventos: admin y despachador cambian" on public.eventos
  for update to authenticated
  using (public.current_role()::text in ('admin', 'despachador'))
  with check (public.current_role()::text in ('admin', 'despachador'));

drop policy if exists "eventos: admin y despachador borran" on public.eventos;
create policy "eventos: admin y despachador borran" on public.eventos
  for delete to authenticated
  using (public.current_role()::text in ('admin', 'despachador'));

grant select, insert, update, delete on public.eventos to authenticated;
