import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, UserRole } from '../../core/services/supabase.service';
import { AvatarComponent } from '../../shared/avatar/avatar.component';

interface UsuarioFila {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  role: UserRole;
  activo: boolean;
  avatar_url: string | null;
}

const BUCKET_AVATARS = 'avatars';
const TAMANO_FOTO = 256; // px, cuadrada

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule, AvatarComponent],
  templateUrl: './usuarios.page.html',
  styleUrls: ['./usuarios.page.scss'],
})
export class UsuariosPage implements OnInit, OnDestroy {
  loading = true;
  usuarios: UsuarioFila[] = [];
  busqueda = '';
  miId: string | null = null;
  guardandoId: string | null = null;
  subiendoFotoId: string | null = null;

  private canal: RealtimeChannel | null = null;

  readonly roles: { valor: UserRole; etiqueta: string }[] = [
    { valor: 'admin', etiqueta: 'Admin' },
    { valor: 'despachador', etiqueta: 'Despachador' },
    { valor: 'vendedor', etiqueta: 'Vendedor' },
    { valor: 'domiciliario', etiqueta: 'Domiciliario' },
  ];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    const user = await this.supabase.getCurrentUser();
    this.miId = user?.id ?? null;
    await this.cargarUsuarios();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('usuarios-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          this.cargarUsuarios();
        }
      )
      .subscribe();
  }

  async cargarUsuarios(): Promise<void> {
    if (!this.usuarios.length) this.loading = true;
    const { data, error } = await this.supabase.client
      .from('profiles')
      // '*' para incluir avatar_url sin fallar si la columna aún no existe
      .select('*')
      .order('nombre');

    if (!error && data) {
      this.usuarios = (data as any[]).map((u) => ({
        id: u.id,
        nombre: u.nombre,
        email: u.email ?? null,
        telefono: u.telefono ?? null,
        role: u.role,
        activo: u.activo,
        avatar_url: u.avatar_url ?? null,
      }));
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  get filtrados(): UsuarioFila[] {
    if (!this.busqueda.trim()) return this.usuarios;
    const q = this.busqueda.trim().toLowerCase();
    return this.usuarios.filter(
      (u) =>
        u.nombre.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q)
    );
  }

  async cambiarRol(usuario: UsuarioFila, nuevoRol: UserRole): Promise<void> {
    if (usuario.id === this.miId || nuevoRol === usuario.role) return;

    this.guardandoId = usuario.id;
    const { error } = await this.supabase.client
      .from('profiles')
      .update({ role: nuevoRol })
      .eq('id', usuario.id);

    this.guardandoId = null;

    if (error) {
      await this.cargarUsuarios();
    } else {
      this.cdr.detectChanges();
    }
  }

  async toggleActivo(usuario: UsuarioFila): Promise<void> {
    if (usuario.id === this.miId) return;

    const nuevoEstado = !usuario.activo;
    const confirmado = confirm(
      nuevoEstado
        ? `¿Reactivar a ${usuario.nombre}?`
        : `¿Desactivar a ${usuario.nombre}? No podrá iniciar sesión hasta que lo reactives.`
    );
    if (!confirmado) return;

    this.guardandoId = usuario.id;
    const { error } = await this.supabase.client
      .from('profiles')
      .update({ activo: nuevoEstado })
      .eq('id', usuario.id);

    this.guardandoId = null;

    if (!error) {
      await this.cargarUsuarios();
    } else {
      this.cdr.detectChanges();
    }
  }

  // --- Foto de perfil ---

  async onFotoElegida(usuario: UsuarioFila, evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;

    if (!archivo.type.startsWith('image/')) {
      alert('Elige una imagen (JPG, PNG o similar).');
      return;
    }

    this.subiendoFotoId = usuario.id;
    this.cdr.detectChanges();

    try {
      const foto = await this.recortarCuadrada(archivo, TAMANO_FOTO);
      const ruta = `${usuario.id}.jpg`;

      const { error: errorSubida } = await this.supabase.client.storage
        .from(BUCKET_AVATARS)
        .upload(ruta, foto, { upsert: true, contentType: 'image/jpeg' });
      if (errorSubida) throw errorSubida;

      const { data } = this.supabase.client.storage.from(BUCKET_AVATARS).getPublicUrl(ruta);
      // El parámetro v obliga a recargar la foto nueva (misma ruta que la anterior)
      const url = `${data.publicUrl}?v=${Date.now()}`;

      const { error: errorPerfil } = await this.supabase.client
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', usuario.id);
      if (errorPerfil) throw errorPerfil;

      usuario.avatar_url = url;
    } catch (err: any) {
      alert('No se pudo guardar la foto. ' + (err?.message ?? 'Intenta de nuevo.'));
    } finally {
      this.subiendoFotoId = null;
      this.cdr.detectChanges();
    }
  }

  async quitarFoto(usuario: UsuarioFila): Promise<void> {
    if (!usuario.avatar_url) return;
    if (!confirm(`¿Quitar la foto de ${usuario.nombre}?`)) return;

    this.subiendoFotoId = usuario.id;
    this.cdr.detectChanges();

    await this.supabase.client.storage.from(BUCKET_AVATARS).remove([`${usuario.id}.jpg`]);
    const { error } = await this.supabase.client
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', usuario.id);

    if (!error) usuario.avatar_url = null;
    else alert('No se pudo quitar la foto. ' + error.message);

    this.subiendoFotoId = null;
    this.cdr.detectChanges();
  }

  /** Recorta al centro y reduce la imagen a un cuadrado JPEG liviano. */
  private recortarCuadrada(archivo: File, lado: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => {
        const corte = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - corte) / 2;
        const sy = (img.naturalHeight - corte) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = lado;
        canvas.height = lado;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('El navegador no pudo procesar la imagen.'));
          return;
        }
        ctx.drawImage(img, sx, sy, corte, corte, 0, 0, lado, lado);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo convertir la imagen.'))),
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la imagen.'));
      };
      img.src = url;
    });
  }

  etiquetaRol(role: UserRole): string {
    return this.roles.find((r) => r.valor === role)?.etiqueta ?? role;
  }
}
