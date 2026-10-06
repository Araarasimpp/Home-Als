-- Home ALS · 2026-10-06 · Un usuario puede tener varios roles.
--
-- profiles.roles  = todos los roles que el admin le dio a la persona.
-- profiles.role   = el rol con el que está trabajando AHORA (el "modo").
--
-- Todos los permisos (RLS, funciones, pantallas) siguen usando profiles.role,
-- así que nada de lo existente cambia: la persona cambia de modo desde la app
-- con cambiar_rol() y solo puede elegir entre los roles que el admin le dio.
-- Sin begin/commit: el workflow "SQL en Supabase" lo envuelve en una transacción.

alter table public.profiles
  add column if not exists roles public.user_role[] not null default array['vendedor']::public.user_role[];

-- Cada persona arranca con el rol que ya tenía (sin disparar registro ni protecciones)
alter table public.profiles disable trigger trg_proteger_rol_perfil;
alter table public.profiles disable trigger trg_actividad_profiles;
update public.profiles set roles = array[role];
alter table public.profiles enable trigger trg_proteger_rol_perfil;
alter table public.profiles enable trigger trg_actividad_profiles;

alter table public.profiles
  add constraint profiles_roles_no_vacio check (cardinality(roles) > 0),
  add constraint profiles_role_en_roles check (role = any (roles));

-- Mantiene role y roles coherentes:
--  - si el admin cambia la lista y el modo actual ya no está, pasa al primero (por importancia);
--  - si se cambia solo "role" a uno que no está en la lista (pantallas viejas), la lista pasa a ser ese rol.
create or replace function public.sincronizar_roles()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_orden public.user_role[] := array['admin', 'despachador', 'vendedor', 'domiciliario']::public.user_role[];
begin
  -- Sin repetidos y en orden de importancia
  select coalesce(array_agg(r order by array_position(v_orden, r)), array['vendedor']::public.user_role[])
    into new.roles
    from (select distinct unnest(new.roles) as r) x;

  if tg_op = 'UPDATE' and new.roles is not distinct from old.roles and not (new.role = any (new.roles)) then
    new.roles := array[new.role];
  elsif not (new.role = any (new.roles)) then
    new.role := new.roles[1];
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sincronizar_roles on public.profiles;
create trigger trg_sincronizar_roles
  before insert or update of role, roles on public.profiles
  for each row execute function public.sincronizar_roles();

-- Solo el admin cambia la lista de roles o activa/desactiva.
-- Cada persona puede cambiar su propio modo, pero solo a un rol de su lista (vía cambiar_rol).
create or replace function public.proteger_rol_perfil()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cambio_propio boolean :=
    coalesce(current_setting('homeals.cambio_rol', true), '') = '1'
    and new.id = auth.uid()
    and new.roles is not distinct from old.roles
    and new.activo is not distinct from old.activo
    and new.role = any (old.roles);
begin
  if (new.role is distinct from old.role or new.roles is distinct from old.roles
      or new.activo is distinct from old.activo or new.id is distinct from old.id)
     and auth.uid() is not null  -- el SQL Editor (sin usuario) sí puede
     and not v_cambio_propio
     and not public.tiene_rol(array['admin'])
  then
    raise exception 'Solo un administrador puede cambiar roles o activar/desactivar usuarios';
  end if;
  return new;
end;
$$;

-- Cambiar de modo (rol activo)
create or replace function public.cambiar_rol(p_rol public.user_role)
returns public.user_role
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_roles public.user_role[];
  v_activo boolean;
begin
  select roles, activo into v_roles, v_activo from public.profiles where id = auth.uid();
  if v_roles is null then raise exception 'No hay sesión'; end if;
  if not v_activo then raise exception 'Tu usuario está desactivado'; end if;
  if not (p_rol = any (v_roles)) then
    raise exception 'No tienes el rol %', p_rol;
  end if;

  perform set_config('homeals.cambio_rol', '1', true);
  update public.profiles set role = p_rol where id = auth.uid() and role is distinct from p_rol;
  perform set_config('homeals.cambio_rol', '', true);
  return p_rol;
end;
$$;

revoke all on function public.cambiar_rol(public.user_role) from public, anon;
grant execute on function public.cambiar_rol(public.user_role) to authenticated;

-- Avisos: le llegan a quien TENGA el rol, aunque en ese momento esté en otro modo
create or replace function public.avisar_roles(p_roles text[], p_tipo text, p_titulo text, p_cuerpo text, p_url_admin text, p_url_despachador text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, url)
  select p.id, p_tipo, p_titulo, p_cuerpo,
         case when 'admin' = any (p.roles::text[]) then p_url_admin else p_url_despachador end
  from public.profiles p
  where p.roles::text[] && p_roles and p.activo
    and p.id is distinct from auth.uid();
$$;

-- Registro de actividad: también anota cambios en la lista de roles
-- (los cambios de modo que hace la propia persona no se anotan: son de todos los días)
create or replace function public.actividad_profiles()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cambios text[] := '{}';
begin
  if new.roles is distinct from old.roles then
    cambios := cambios || ('roles: ' || array_to_string(old.roles::text[], ', ') || ' → ' || array_to_string(new.roles::text[], ', '));
  elsif new.role is distinct from old.role and coalesce(current_setting('homeals.cambio_rol', true), '') <> '1' then
    cambios := cambios || ('rol: ' || old.role::text || ' → ' || new.role::text);
  end if;
  if new.activo is distinct from old.activo then cambios := cambios || (case when new.activo then 'reactivado' else 'desactivado' end); end if;
  if new.comision_tipo is distinct from old.comision_tipo then
    cambios := cambios || ('comisión: ' || old.comision_tipo || ' → ' || new.comision_tipo);
  end if;
  if new.comision_porcentaje is distinct from old.comision_porcentaje then
    cambios := cambios || ('porcentaje: ' || old.comision_porcentaje || '% → ' || new.comision_porcentaje || '%');
  end if;
  if array_length(cambios, 1) > 0 then
    perform public.registrar_actividad('usuario', new.id::text, 'editar',
      'Cambió a ' || new.nombre || ': ' || array_to_string(cambios, ', '));
  end if;
  return null;
end;
$$;
