import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { callOutline, logoWhatsapp, navigateOutline, alertCircleOutline } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { inicioDiaColombia } from '../../shared/fecha-colombia';
import { efectivoDePedido } from '../../shared/models/models';
import { EstadoIconComponent } from '../../shared/estado-icon/estado-icon.component';
import { EntregarPedidoComponent } from '../entregar-pedido/entregar-pedido.component';

interface PedidoRuta {
  id: string;
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  valor_domicilio: number;
  total: number;
  observaciones: string | null;
  productos: string[];
}

@Component({
  selector: 'app-inicio-domiciliario',
  standalone: true,
  imports: [CommonModule, RouterLink, IonIcon, EstadoIconComponent, EntregarPedidoComponent],
  templateUrl: './inicio.page.html',
  styleUrls: ['../../shared/ui.scss', './inicio.page.scss'],
})
export class InicioDomiciliarioPage implements OnInit, OnDestroy {
  loading = true;
  pedidos: PedidoRuta[] = [];
  pedidoEntregando: PedidoRuta | null = null;

  // Resumen del día
  entregadosHoy = 0;
  efectivoEnMano = 0; // efectivo cobrado hoy que todavía no está en un cuadre
  porCuadrar = 0;

  private canal: RealtimeChannel | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {
    addIcons({ callOutline, logoWhatsapp, navigateOutline, alertCircleOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.cargarPedidos();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('mis-pedidos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        if (this.temporizador) clearTimeout(this.temporizador);
        this.temporizador = setTimeout(() => this.cargarPedidos(), 300);
      })
      .subscribe();
  }

  async cargarPedidos(): Promise<void> {
    if (!this.pedidos.length) this.loading = true;
    const user = await this.supabase.getCurrentUser();

    if (!user) {
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }

    const [rutaRes, hoyRes] = await Promise.all([
      this.supabase.client
        .from('pedidos')
        .select(
          'id, numero, cliente_nombre, cliente_telefono, direccion, barrio, valor_domicilio, total, observaciones'
        )
        .eq('domiciliario_id', user.id)
        .eq('estado', 'en_ruta')
        .order('created_at', { ascending: true }),
      this.supabase.client
        .from('pedidos')
        // '*' incluye monto_efectivo (pago mixto)
        .select('*')
        .eq('domiciliario_id', user.id)
        .eq('estado', 'entregado')
        .gte('entregado_at', inicioDiaColombia().toISOString()),
    ]);

    let pedidos = (rutaRes.data as any[]) ?? [];

    if (!rutaRes.error && pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, producto:productos(nombre)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      pedidos = pedidos.map((p) => ({
        ...p,
        productos: (items ?? [])
          .filter((i: any) => i.pedido_id === p.id)
          .map((i: any) =>
            i.cantidad > 1
              ? `${i.producto?.nombre ?? 'Producto'} ×${i.cantidad}`
              : `${i.producto?.nombre ?? 'Producto'}`
          ),
      }));
    }

    const hoy = (hoyRes.data ?? []) as any[];
    this.entregadosHoy = hoy.length;
    const sinCuadre = hoy.filter((p) => !p.cuadre_id);
    this.porCuadrar = sinCuadre.length;
    this.efectivoEnMano = sinCuadre.reduce((s, p) => s + efectivoDePedido(p), 0);

    this.pedidos = pedidos as PedidoRuta[];
    this.loading = false;
    this.cdr.detectChanges();
  }

  // ---------- Botones de acción ----------

  llamar(pedido: PedidoRuta): void {
    if (!pedido.cliente_telefono) return;
    window.open(`tel:${pedido.cliente_telefono}`, '_self');
  }

  whatsapp(pedido: PedidoRuta): void {
    if (!pedido.cliente_telefono) return;
    const numero = this.normalizarTelefono(pedido.cliente_telefono);
    window.open(`https://wa.me/${numero}`, '_blank');
  }

  navegar(pedido: PedidoRuta): void {
    const destino = encodeURIComponent(`${pedido.direccion}, ${pedido.barrio ?? ''}`);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destino}`, '_blank');
  }

  private normalizarTelefono(telefono: string): string {
    const soloNumeros = telefono.replace(/\D/g, '');
    return soloNumeros.length > 10 ? soloNumeros : `57${soloNumeros}`;
  }

  // ---------- Marcar entregado ----------

  abrirEntrega(pedido: PedidoRuta): void {
    this.pedidoEntregando = pedido;
  }

  cerrarEntrega(): void {
    this.pedidoEntregando = null;
  }

  async onEntregado(): Promise<void> {
    this.pedidoEntregando = null;
    await this.cargarPedidos();
  }

  formatoMoneda(valor: number): string {
    return Number(valor || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}
