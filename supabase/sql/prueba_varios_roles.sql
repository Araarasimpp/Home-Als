-- Prueba (solo modo "probar": todo se deshace al final).
\i supabase/sql/2026-10-06_varios_roles.sql

do $$
declare
  v_dom uuid; v_p public.profiles%rowtype; v_ok boolean;
begin
  select id into v_dom from public.profiles where role = 'domiciliario' limit 1;
  raise notice 'perfiles con roles = rol: %', (select count(*) from public.profiles where roles = array[role]);

  -- El admin (aquí: sin usuario) le da dos roles
  update public.profiles set roles = array['domiciliario','vendedor']::public.user_role[] where id = v_dom;
  select * into v_p from public.profiles where id = v_dom;
  raise notice 'roles=% role=%', v_p.roles, v_p.role;
  assert v_p.roles = array['vendedor','domiciliario']::public.user_role[] and v_p.role = 'domiciliario', 'orden y modo';

  -- La persona cambia de modo
  perform set_config('request.jwt.claims', json_build_object('sub', v_dom, 'role', 'authenticated')::text, true);
  perform public.cambiar_rol('vendedor');
  select * into v_p from public.profiles where id = v_dom;
  raise notice 'tras cambiar_rol: role=% current_role=%', v_p.role, public.current_role();
  assert v_p.role = 'vendedor', 'cambio de modo';

  -- No puede darse un rol que no tiene
  v_ok := false;
  begin perform public.cambiar_rol('admin'); exception when others then v_ok := true; raise notice 'bloqueado cambiar_rol(admin): %', sqlerrm; end;
  assert v_ok, 'cambiar_rol admin';

  -- Ni editar su lista de roles directamente
  v_ok := false;
  declare v_ctx text; begin
    update public.profiles set roles = array['admin']::public.user_role[] where id = v_dom;
  exception when others then v_ok := true; get stacked diagnostics v_ctx = pg_exception_context; raise notice 'bloqueado editar roles: % | %', sqlerrm, v_ctx; end;
  assert v_ok, 'editar roles';

  -- Ni cambiar role a algo fuera de su lista
  v_ok := false;
  begin
    update public.profiles set role = 'admin' where id = v_dom;
  exception when others then v_ok := true; raise notice 'bloqueado role=admin: %', sqlerrm; end;
  assert v_ok, 'role admin';

  -- Pantalla vieja: admin cambia solo "role" -> la lista pasa a ser ese rol
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set role = 'despachador' where id = v_dom;
  select * into v_p from public.profiles where id = v_dom;
  raise notice 'solo role: roles=% role=%', v_p.roles, v_p.role;
  assert v_p.roles = array['despachador']::public.user_role[], 'pantalla vieja';
  raise notice 'TODO OK';
end $$;
