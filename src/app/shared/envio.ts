// Regla del envío que se pone sobre lo cobrado al cliente (Reportes, su Excel y la comisión que ve el vendedor).
/**
 * Envío que se pone por encima de lo cobrado al cliente (en barrios normales el
 * cliente paga 9.000 y el domiciliario recibe 10.000: se ponen 1.000). Lo asume
 * la tienda; si el pedido es de un vendedor por %, se reparte mitad y mitad
 * (500 de su comisión y 500 de la ganancia de la tienda).
 */
export function repartoEnvio(p: any): { tienda: number; vendedor: number } {
  if (p.canal === 'local') return { tienda: 0, vendedor: 0 };
  const extra = Math.max(0, Number(p.pago_domiciliario ?? p.valor_domicilio ?? 0) - Number(p.valor_domicilio ?? 0));
  if (!extra) return { tienda: 0, vendedor: 0 };
  if (p.comision_tipo === 'porcentaje') {
    const vendedor = Math.round(extra / 2);
    return { tienda: extra - vendedor, vendedor };
  }
  return { tienda: extra, vendedor: 0 };
}
