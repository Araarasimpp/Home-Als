// Consultas con muchos ids, partidas en grupos.
//
// Un filtro .in('pedido_id', ids) pone todos los ids en la dirección de la
// consulta. Con más de ~500 pedidos esa dirección pasa el límite del servidor y
// responde error 400: la lista de Pedidos quedaba en "Sin productos" y sin fotos.
// Aquí se piden de a 150 y se juntan los resultados.
import { SupabaseClient } from '@supabase/supabase-js';

const TAM_LOTE = 150;

function lotes(ids: string[]): string[][] {
  const unicos = [...new Set(ids)];
  const salida: string[][] = [];
  for (let i = 0; i < unicos.length; i += TAM_LOTE) salida.push(unicos.slice(i, i + TAM_LOTE));
  return salida;
}

/** Filas de pedido_items de esos pedidos (con el select que se pida). */
export async function itemsDePedidos<T = any>(
  db: SupabaseClient,
  select: string,
  pedidoIds: string[]
): Promise<{ data: T[]; error: any }> {
  const res = await Promise.all(
    lotes(pedidoIds).map((lote) => db.from('pedido_items').select(select).in('pedido_id', lote))
  );
  const error = res.find((r) => r.error)?.error ?? null;
  return { data: res.flatMap((r) => (r.data ?? []) as T[]), error };
}

/** update(cambios) sobre muchos pedidos, por grupos. */
export async function actualizarPedidos(
  db: SupabaseClient,
  cambios: Record<string, unknown>,
  ids: string[]
): Promise<{ error: any }> {
  const res = await Promise.all(lotes(ids).map((lote) => db.from('pedidos').update(cambios).in('id', lote)));
  return { error: res.find((r) => r.error)?.error ?? null };
}
