export type UserRole = 'admin' | 'vendedor' | 'domiciliario' | 'despachador';
export type EstadoPedido = 'pendiente' | 'en_ruta' | 'entregado' | 'cancelado';
/** 'mixto' = una parte en efectivo y el resto por transferencia */
export type MetodoPago = 'efectivo' | 'transferencia' | 'mixto';

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  descripcion: string | null;
  costo: number | null;
  precio_base: number;
  precio_sugerido: number;
  imagen_url: string | null;
  stock: number;
  categoria: string | null;
  activo: boolean;
}

export interface PedidoItem {
  id: string;
  pedido_id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  precio_base: number;
}

export interface Pedido {
  id: string;
  numero: number;
  vendedor_id: string;
  domiciliario_id?: string | null;
  cliente_id?: string | null;
  cliente_nombre: string;
  cliente_telefono?: string | null;
  direccion: string;
  barrio?: string | null;
  valor_domicilio: number;
  comision: number;
  observaciones?: string | null;
  estado: EstadoPedido;
  total: number;
  metodo_pago?: MetodoPago | null;
  /** Lo cobrado en efectivo (lo calcula la base de datos según el método) */
  monto_efectivo?: number | null;
  /** Lo cobrado por transferencia */
  monto_transferencia?: number | null;
  comprobante_url?: string | null;
  rotulo_impreso_at?: string | null;
  cuadre_id?: string | null;
  created_at: string;
  entregado_at?: string | null;
  items?: PedidoItem[];
}

export type EstadoCuadre = 'pendiente' | 'confirmado';

export interface Cuadre {
  id: string;
  domiciliario_id: string;
  fecha: string;
  cantidad_pedidos: number;
  total_domicilios: number;
  total_efectivo: number;
  total_transferencia: number;
  total_general: number;
  total_a_entregar: number;
  estado: EstadoCuadre;
  cerrado_at: string;
  confirmado_at?: string | null;
  confirmado_por?: string | null;
}

export interface CrearPedidoPayload {
  p_cliente_nombre: string;
  p_cliente_telefono?: string;
  p_direccion: string;
  p_barrio?: string;
  p_valor_domicilio: number;
  p_observaciones?: string;
  p_items: {
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
    precio_base: number;
  }[];
}

/** Lo cobrado en efectivo en un pedido (sirve también para pedidos viejos sin montos). */
export function efectivoDePedido(p: { metodo_pago?: MetodoPago | null; total: number; monto_efectivo?: number | null }): number {
  if (p.monto_efectivo != null) return Number(p.monto_efectivo);
  return p.metodo_pago === 'efectivo' ? Number(p.total) : 0;
}

/** Lo cobrado por transferencia en un pedido. */
export function transferenciaDePedido(p: { metodo_pago?: MetodoPago | null; total: number; monto_transferencia?: number | null }): number {
  if (p.monto_transferencia != null) return Number(p.monto_transferencia);
  return p.metodo_pago === 'transferencia' ? Number(p.total) : 0;
}

export function etiquetaMetodo(m: MetodoPago | null | undefined): string {
  return m === 'transferencia' ? 'Transferencia' : m === 'mixto' ? 'Mixto' : m === 'efectivo' ? 'Efectivo' : '—';
}
