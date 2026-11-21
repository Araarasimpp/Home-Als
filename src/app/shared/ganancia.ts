// Ganancia de la TIENDA en un pedido, con la misma regla de Reportes:
//  - Vendedor por margen: (precio base − costo) por unidad; lo cobrado por encima
//    del precio base es comisión del vendedor.
//  - Vendedor por %: (precio de venta − costo) menos el % del vendedor.
//  - Menos la parte de la tienda en el envío que se pone sobre lo cobrado.
// Si un producto no tiene costo registrado se usa su precio base.
import { repartoEnvio } from './envio';

export interface ItemGanancia {
  cantidad: number;
  precio_unitario: number;
  precio_base: number;
  producto?: { costo?: number | null } | null;
}

export function gananciaTiendaPedido(p: any, items: ItemGanancia[]): number {
  const pct = p.comision_tipo === 'porcentaje' ? Number(p.comision_porcentaje ?? 0) : null;
  let g = 0;
  for (const i of items) {
    const q = Number(i.cantidad) || 0;
    const pu = Number(i.precio_unitario) || 0;
    const pb = Number(i.precio_base) || 0;
    const c = i.producto?.costo != null ? Number(i.producto.costo) : pb;
    g += pct !== null ? Math.round(q * (pu - c) * (1 - pct / 100)) : q * (pb - c);
  }
  return g - repartoEnvio(p).tienda;
}
