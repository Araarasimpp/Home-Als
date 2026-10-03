import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { SupabaseService } from '../../core/services/supabase.service';

/**
 * Activar / desactivar la verificación en dos pasos de la cuenta actual.
 * Se usa en Configuración → Seguridad.
 */
@Component({
  selector: 'app-mfa-config',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (cargando) {
      <p class="nota">Revisando…</p>
    } @else if (factorId) {
      <div class="estado on">
        <span class="punto" aria-hidden="true"></span>
        <div>
          <strong>Verificación en dos pasos activa</strong>
          <p class="nota">Al iniciar sesión se pide el código de tu app de autenticación.</p>
        </div>
        <button class="btn btn-peligro" (click)="desactivar()" [disabled]="trabajando">Desactivar</button>
      </div>
    } @else if (qr) {
      <ol class="pasos">
        <li>Instala <strong>Google Authenticator</strong> o <strong>Authy</strong> en tu celular.</li>
        <li>En la app toca <strong>+</strong> → <strong>Escanear código QR</strong> y escanea este código:</li>
      </ol>
      <div class="qr-wrap">
        <img [src]="qr" alt="Código QR para la app de autenticación" width="180" height="180" />
        <div class="clave">
          <span class="nota">¿No puedes escanear? Escribe esta clave en la app:</span>
          <code>{{ clave }}</code>
        </div>
      </div>
      <form class="verificar" (ngSubmit)="confirmar()">
        <label for="mfa-codigo">3. Escribe el código de 6 números que muestra la app</label>
        <div class="fila">
          <input
            id="mfa-codigo"
            name="codigo"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            placeholder="000000"
            [(ngModel)]="codigo"
          />
          <button type="submit" class="btn btn-primario" [disabled]="trabajando">
            {{ trabajando ? 'Verificando…' : 'Activar' }}
          </button>
          <button type="button" class="btn" (click)="cancelar()" [disabled]="trabajando">Cancelar</button>
        </div>
      </form>
    } @else {
      <div class="estado">
        <span class="punto" aria-hidden="true"></span>
        <div>
          <strong>Verificación en dos pasos desactivada</strong>
          <p class="nota">Recomendada para el admin: aunque alguien sepa tu contraseña, no podrá entrar sin tu celular.</p>
        </div>
        <button class="btn btn-primario" (click)="iniciar()" [disabled]="trabajando">Activar</button>
      </div>
    }
    @if (error) {
      <p class="error" role="alert">{{ error }}</p>
    }
    @if (ok) {
      <p class="ok" role="status">{{ ok }}</p>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 12px; }
      .estado { display: flex; align-items: center; gap: 12px; }
      .estado > div { flex: 1; min-width: 0; }
      .estado strong { font-size: 14px; font-weight: 600; }
      .punto { width: 10px; height: 10px; border-radius: 50%; background: var(--border-strong); flex-shrink: 0; }
      .estado.on .punto { background: var(--st-entregado); }
      .nota { margin: 2px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-muted); }
      .pasos { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6; color: var(--text-2); }
      .qr-wrap { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
      .qr-wrap img { border-radius: var(--radius); background: #fff; padding: 6px; border: 1px solid var(--border); }
      .clave { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      code { font-size: 13px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--surface-2); overflow-wrap: anywhere; user-select: all; }
      .verificar label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; }
      .fila { display: flex; gap: 8px; flex-wrap: wrap; }
      .fila input { width: 140px; height: 38px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 18px; letter-spacing: 0.2em; text-align: center; }
      .btn { height: 38px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
      .btn-primario { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
      .btn-peligro { color: var(--danger); }
      .btn:disabled { opacity: 0.6; cursor: progress; }
      .error { margin: 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--danger-wash); color: var(--danger); font-size: 13px; }
      .ok { margin: 0; font-size: 13px; color: var(--st-entregado); font-weight: 500; }
    `,
  ],
})
export class MfaConfigComponent implements OnInit {
  cargando = true;
  trabajando = false;
  factorId: string | null = null;

  // Proceso de activación
  private factorNuevo: string | null = null;
  qr: SafeUrl | null = null;
  clave = '';
  codigo = '';

  error = '';
  ok = '';

  constructor(
    private supabase: SupabaseService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    const f = await this.supabase.factorMfaActivo();
    this.factorId = f?.id ?? null;
    this.cargando = false;
    this.cdr.detectChanges();
  }

  async iniciar(): Promise<void> {
    this.error = '';
    this.ok = '';
    this.trabajando = true;
    this.cdr.detectChanges();
    try {
      const r = await this.supabase.iniciarMfa();
      this.factorNuevo = r.factorId;
      // Supabase entrega el QR como imagen SVG en data URL
      this.qr = this.sanitizer.bypassSecurityTrustUrl(r.qr);
      this.clave = r.clave;
    } catch (e: any) {
      this.error = 'No se pudo iniciar. ' + (e?.message ?? '');
    }
    this.trabajando = false;
    this.cdr.detectChanges();
  }

  async confirmar(): Promise<void> {
    if (!this.factorNuevo) return;
    const codigo = this.codigo.replace(/\s/g, '');
    if (!/^\d{6}$/.test(codigo)) {
      this.error = 'Escribe los 6 números que muestra la app.';
      return;
    }
    this.error = '';
    this.trabajando = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.verificarCodigoMfa(this.factorNuevo, codigo);
    this.trabajando = false;
    if (error) {
      this.error = 'El código no coincide. Revisa que la hora del celular esté en automático y usa el código actual.';
      this.codigo = '';
    } else {
      this.factorId = this.factorNuevo;
      this.factorNuevo = null;
      this.qr = null;
      this.clave = '';
      this.codigo = '';
      this.ok = 'Listo. Desde ahora se pedirá el código al iniciar sesión.';
    }
    this.cdr.detectChanges();
  }

  async cancelar(): Promise<void> {
    if (this.factorNuevo) await this.supabase.desactivarMfa(this.factorNuevo);
    this.factorNuevo = null;
    this.qr = null;
    this.clave = '';
    this.codigo = '';
    this.error = '';
    this.cdr.detectChanges();
  }

  async desactivar(): Promise<void> {
    if (!this.factorId) return;
    if (!confirm('¿Desactivar la verificación en dos pasos? Tu cuenta quedará protegida solo con la contraseña.')) return;
    this.trabajando = true;
    this.cdr.detectChanges();
    const { error } = await this.supabase.desactivarMfa(this.factorId);
    this.trabajando = false;
    if (error) {
      this.error = 'No se pudo desactivar. Cierra sesión, vuelve a entrar con el código e inténtalo de nuevo.';
    } else {
      this.factorId = null;
      this.ok = 'Verificación en dos pasos desactivada.';
    }
    this.cdr.detectChanges();
  }
}
