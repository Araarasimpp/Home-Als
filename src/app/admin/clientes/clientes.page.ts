import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { logoWhatsapp, searchOutline, chevronDownOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { EstadoIconComponent } from '../../shared/estado-icon/estado-icon.component';

interface Cliente {
  id: string;
  telefono: string;
  nombre: string;
  direccion: string | null;
  barrio: string | null;
  notas: string | null;
  pedidos: number;
  total_comprado: number;
  ultima_compra: string | null;
  created_at: string;
}

interface PedidoCliente {
  id: string;
  numero: number;
  total: number;
  estado: EstadoPedido;
  created_at: string;
}

type Orden = 'recientes' | 'compras' | 'nombre';

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, EstadoIconComponent],
  templateUrl: './clientes.page.html',
  styleUrls: ['../../shared/ui.scss', './clientes.page.scss'],
})
export class ClientesPage implements OnInit {
  loading = true;
  errorMsg = '';
  clientes: Cliente[] = [];
  busqueda = '';
  orden: Orden = 'recientes';
  abiertoId: string | null = null;
  pedidosDe = new Map<string, PedidoCliente[]>();
  guardandoNotas = false;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {
    addIcons({ logoWhatsapp, searchOutline, chevronDownOutline });
  }

  async ngOnInit(): Promise<void> {
    const { data, error } = await this.supabase.client.from('clientes_resumen').select('*').limit(5000);
    if (error) {
      this.errorMsg = /clientes_resumen/.test(error.message)
        ? 'Falta ejecutar el archivo supabase/mejoras-clientes-avisos-actividad.sql en Supabase.'
        : 'No se pudieron cargar los clientes. ' + error.message;
    } else {
      this.clientes = (data ?? []).map((c: any) => ({
        ...c,
        pedidos: Number(c.pedidos || 0),
        total_comprado: Number(c.total_comprado || 0),
      }));
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  get filtrados(): Cliente[] {
    const q = this.busqueda.trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    let lista = this.clientes.filter(
      (c) =>
        !q ||
        c.nombre.toLowerCase().includes(q) ||
        (digitos.length >= 3 && c.telefono.includes(digitos)) ||
        (c.barrio ?? '').toLowerCase().includes(q)
    );
    lista = [...lista].sort((a, b) => {
      if (this.orden === 'compras') return b.total_comprado - a.total_comprado;
      if (this.orden === 'nombre') return a.nombre.localeCompare(b.nombre);
      return (b.ultima_compra ?? b.created_at).localeCompare(a.ultima_compra ?? a.created_at);
    });
    return lista;
  }

  get totalComprado(): number {
    return this.clientes.reduce((s, c) => s + c.total_comprado, 0);
  }

  get recurrentes(): number {
    return this.clientes.filter((c) => c.pedidos > 1).length;
  }

  async toggle(c: Cliente): Promise<void> {
    if (this.abiertoId === c.id) {
      this.abiertoId = null;
      return;
    }
    this.abiertoId = c.id;
    if (!this.pedidosDe.has(c.id)) {
      const { data } = await this.supabase.client
        .from('pedidos')
        .select('id, numero, total, estado, created_at')
        .eq('cliente_id', c.id)
        .order('created_at', { ascending: false })
        .limit(15);
      this.pedidosDe.set(c.id, (data ?? []) as PedidoCliente[]);
      this.cdr.detectChanges();
    }
  }

  async guardarNotas(c: Cliente, evento: Event): Promise<void> {
    const notas = (evento.target as HTMLTextAreaElement).value.trim() || null;
    if (notas === c.notas) return;
    this.guardandoNotas = true;
    const { error } = await this.supabase.client.from('clientes').update({ notas }).eq('id', c.id);
    this.guardandoNotas = false;
    if (error) alert('No se pudieron guardar las notas. ' + error.message);
    else c.notas = notas;
    this.cdr.detectChanges();
  }

  whatsapp(c: Cliente): string {
    return `https://wa.me/57${c.telefono}`;
  }

  telefonoBonito(t: string): string {
    return t.length === 10 ? `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}` : t;
  }

  formatoMoneda(v: number): string {
    return Number(v || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  }

  fecha(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'America/Bogota',
    });
  }
}
