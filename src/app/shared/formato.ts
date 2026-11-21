// Formatos de dinero y fechas que se repiten en las páginas de dinero.

/** $1.234.567 */
export function pesos(n: number | string | null | undefined): string {
  const x = Math.round(Number(n) || 0);
  return (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('es-CO');
}

/** $2,4 M · $350 mil · $900 */
export function pesosCorto(n: number | string | null | undefined): string {
  const x = Number(n) || 0;
  if (Math.abs(x) >= 1_000_000) return `$${(x / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(x) >= 1000) return `$${Math.round(x / 1000).toLocaleString('es-CO')} mil`;
  return `$${Math.round(x).toLocaleString('es-CO')}`;
}

/** Suma días a una fecha YYYY-MM-DD */
export function sumarDias(d: string, n: number): string {
  const f = new Date(d + 'T12:00:00Z');
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().slice(0, 10);
}

/** "sáb 14 nov" */
export function diaCorto(d: string): string {
  return new Date(d + 'T12:00:00Z')
    .toLocaleDateString('es-CO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/\./g, '')
    .replace(',', '');
}

/** Mensaje entendible de un error de Supabase */
export function mensajeError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e ?? '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión. Revisa el internet e intenta otra vez.';
  return m || 'Algo salió mal. Intenta otra vez.';
}
