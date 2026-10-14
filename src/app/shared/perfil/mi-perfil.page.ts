import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cameraOutline, logOutOutline, sunnyOutline, moonOutline, notificationsOutline, lockClosedOutline, chevronDownOutline } from 'ionicons/icons';
import { Profile, SupabaseService, UserRole } from '../../core/services/supabase.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { AvatarComponent } from '../avatar/avatar.component';
import { EsqueletoComponent } from '../esqueleto/esqueleto.component';
import { MedidorClaveComponent } from '../seguridad/medidor-clave.component';
import { EvaluacionClave, evaluarClave, vecesFiltrada } from '../seguridad/clave';
import { comprimirImagen } from '../imagenes/comprimir';
import { ETIQUETA_ROL } from '../cambio-rol/cambio-rol.component';
import { FotoEditorComponent } from './foto-editor.component';

const BUCKET_AVATARS = 'avatars';

/**
 * Mi perfil (todos los roles): foto, datos de contacto, contraseña,
 * apariencia, avisos de este dispositivo y cerrar sesión.
 */
@Component({
  selector: 'app-mi-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, AvatarComponent, EsqueletoComponent, MedidorClaveComponent, FotoEditorComponent],
  templateUrl: './mi-perfil.page.html',
  styleUrls: ['../ui.scss', './mi-perfil.page.scss'],
})
export class MiPerfilPage implements OnInit {
  loading = true;
  perfil: Profile | null = null;
  email = '';

  // Foto
  archivoFoto: File | null = null;
  guardandoFoto = false;
  errorFoto = '';

  // Teléfono
  telefono = '';
  private telefonoOriginal = '';
  guardandoTel = false;
  avisoTel = '';

  // Contraseña
  claveAbierta = false;
  clave = '';
  confirmar = '';
  evaluacion: EvaluacionClave = evaluarClave('');
  guardandoClave = false;
  errorClave = '';
  claveOk = false;

  constructor(
    private supabase: SupabaseService,
    public theme: ThemeService,
    public avisos: NotificacionesService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({ cameraOutline, logOutOutline, sunnyOutline, moonOutline, notificationsOutline, lockClosedOutline, chevronDownOutline });
  }

  async ngOnInit(): Promise<void> {
    const [perfil, user] = await Promise.all([this.supabase.getCurrentProfile(), this.supabase.getCurrentUser()]);
    this.perfil = perfil;
    this.email = perfil?.email || user?.email || '';
    this.telefono = this.telefonoOriginal = perfil?.telefono ?? '';
    this.loading = false;
    this.cdr.detectChanges();
  }

  get roles(): string[] {
    const r = (this.perfil?.roles?.length ? this.perfil.roles : this.perfil ? [this.perfil.role] : []) as UserRole[];
    return r.map((x) => ETIQUETA_ROL[x] ?? x);
  }

  // ---------- Foto ----------
  async elegirFoto(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = ''; // permite volver a elegir la misma
    if (!f) return;
    this.errorFoto = '';
    if (!f.type.startsWith('image/')) {
      this.errorFoto = 'Elige una imagen (foto JPG, PNG o similar).';
      return;
    }
    // Se reduce antes de encuadrar: las fotos del celular pesan varios MB
    this.archivoFoto = await comprimirImagen(f, 'avatar');
    this.cdr.detectChanges();
  }

  cancelarFoto(): void {
    if (this.guardandoFoto) return;
    this.archivoFoto = null;
  }

  async guardarFoto(blob: Blob): Promise<void> {
    if (!this.perfil || this.guardandoFoto) return;
    this.guardandoFoto = true;
    this.errorFoto = '';
    this.cdr.detectChanges();
    try {
      const ruta = `${this.perfil.id}.jpg`;
      const { error: errSubida } = await this.supabase.client.storage
        .from(BUCKET_AVATARS)
        .upload(ruta, blob, { upsert: true, contentType: 'image/jpeg' });
      if (errSubida) throw errSubida;
      const { data } = this.supabase.client.storage.from(BUCKET_AVATARS).getPublicUrl(ruta);
      // v= obliga a recargar la foto nueva (misma ruta que la anterior)
      const url = `${data.publicUrl}?v=${Date.now()}`;
      const { error } = await this.supabase.client.from('profiles').update({ avatar_url: url }).eq('id', this.perfil.id);
      if (error) throw error;
      this.perfil = { ...this.perfil, avatar_url: url };
      this.supabase.actualizarPerfilLocal({ avatar_url: url });
      this.archivoFoto = null;
    } catch (e: any) {
      this.errorFoto = /row-level|policy|permission/i.test(e?.message ?? '')
        ? 'Todavía no está activado subir tu propia foto. Avísale al administrador.'
        : 'No se pudo guardar la foto. Revisa tu conexión e intenta de nuevo.';
    } finally {
      this.guardandoFoto = false;
      this.cdr.detectChanges();
    }
  }

  async quitarFoto(): Promise<void> {
    if (!this.perfil?.avatar_url || this.guardandoFoto) return;
    if (!confirm('¿Quitar tu foto de perfil?')) return;
    this.guardandoFoto = true;
    this.cdr.detectChanges();
    await this.supabase.client.storage.from(BUCKET_AVATARS).remove([`${this.perfil.id}.jpg`]);
    const { error } = await this.supabase.client.from('profiles').update({ avatar_url: null }).eq('id', this.perfil.id);
    if (!error) {
      this.perfil = { ...this.perfil, avatar_url: null };
      this.supabase.actualizarPerfilLocal({ avatar_url: null });
    } else {
      this.errorFoto = 'No se pudo quitar la foto. Intenta de nuevo.';
    }
    this.guardandoFoto = false;
    this.cdr.detectChanges();
  }

  // ---------- Teléfono ----------
  get telefonoCambio(): boolean {
    return this.telefono.trim() !== this.telefonoOriginal.trim();
  }

  async guardarTelefono(): Promise<void> {
    if (!this.perfil || this.guardandoTel) return;
    const tel = this.telefono.trim();
    if (tel && tel.replace(/\D/g, '').length < 7) {
      this.avisoTel = 'Escribe un número completo (mínimo 7 dígitos).';
      return;
    }
    this.guardandoTel = true;
    this.avisoTel = '';
    const { error } = await this.supabase.client.from('profiles').update({ telefono: tel || null }).eq('id', this.perfil.id);
    this.guardandoTel = false;
    if (error) {
      this.avisoTel = 'No se pudo guardar el teléfono. Intenta de nuevo.';
    } else {
      this.telefonoOriginal = tel;
      this.supabase.actualizarPerfilLocal({ telefono: tel || undefined });
      this.avisoTel = 'Guardado';
      setTimeout(() => {
        if (this.avisoTel === 'Guardado') this.avisoTel = '';
        this.cdr.detectChanges();
      }, 2200);
    }
    this.cdr.detectChanges();
  }

  // ---------- Contraseña ----------
  alternarClave(): void {
    this.claveAbierta = !this.claveAbierta;
    this.claveOk = false;
    this.errorClave = '';
  }

  evaluar(): void {
    this.evaluacion = evaluarClave(this.clave, { nombre: this.perfil?.nombre, email: this.email });
  }

  get noCoinciden(): boolean {
    return this.confirmar.length > 0 && this.confirmar !== this.clave;
  }

  async guardarClave(): Promise<void> {
    if (this.guardandoClave) return;
    this.errorClave = '';
    this.evaluar();
    if (!this.evaluacion.valida) {
      this.errorClave = 'La contraseña todavía no cumple todos los requisitos.';
      return;
    }
    if (this.clave !== this.confirmar) {
      this.errorClave = 'Las dos contraseñas no coinciden.';
      return;
    }
    this.guardandoClave = true;
    this.cdr.detectChanges();
    const filtrada = await vecesFiltrada(this.clave);
    if (filtrada && filtrada > 0) {
      this.guardandoClave = false;
      this.errorClave = 'Esa contraseña aparece en filtraciones de otros sitios, así que ya la conocen. Elige otra.';
      this.cdr.detectChanges();
      return;
    }
    const { error } = await this.supabase.cambiarClave(this.clave);
    this.guardandoClave = false;
    if (error) {
      this.errorClave = /same|different/i.test(error.message)
        ? 'La nueva contraseña debe ser distinta de la actual.'
        : /reauth|recent|nonce/i.test(error.message)
          ? 'Por seguridad, cierra sesión, vuelve a entrar y cámbiala enseguida.'
          : 'No se pudo cambiar la contraseña. Intenta de nuevo.';
    } else {
      this.clave = this.confirmar = '';
      this.evaluar();
      this.claveOk = true;
      this.claveAbierta = false;
    }
    this.cdr.detectChanges();
  }

  // ---------- Apariencia y sesión ----------
  ponerTema(oscuro: boolean): void {
    if (this.theme.isDark() !== oscuro) this.theme.toggle();
  }

  async cerrarSesion(): Promise<void> {
    this.avisos.detener();
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}
