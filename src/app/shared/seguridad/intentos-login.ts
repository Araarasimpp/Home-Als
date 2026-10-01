// src/app/shared/seguridad/intentos-login.ts
// Frena los intentos de adivinar contraseñas desde este dispositivo:
// tras 5 fallos seguidos con un mismo correo, bloquea 30 s, y el tiempo se
// duplica con cada nuevo fallo (30 s, 60 s, 2 min… hasta 15 min).
// Se guarda en localStorage para que recargar la página no lo reinicie.
//
// Esto complementa (no reemplaza) los límites de Supabase en el servidor:
// Authentication → Rate Limits.

const CLAVE = 'login-intentos';
const FALLOS_ANTES_DE_BLOQUEAR = 5;
const BLOQUEO_INICIAL_MS = 30_000;
const BLOQUEO_MAXIMO_MS = 15 * 60_000;

interface Registro {
  fallos: number;
  bloqueadoHasta: number;
}

function leer(): Record<string, Registro> {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? '{}');
  } catch {
    return {};
  }
}

function guardar(datos: Record<string, Registro>): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
  } catch {
    /* almacenamiento lleno o deshabilitado: el freno simplemente no persiste */
  }
}

function llave(email: string): string {
  return email.trim().toLowerCase();
}

/** Milisegundos que faltan de bloqueo para ese correo (0 = puede intentar). */
export function msBloqueado(email: string): number {
  const r = leer()[llave(email)];
  return r ? Math.max(0, r.bloqueadoHasta - Date.now()) : 0;
}

export function registrarFallo(email: string): void {
  const datos = leer();
  const k = llave(email);
  const r = datos[k] ?? { fallos: 0, bloqueadoHasta: 0 };
  r.fallos++;
  if (r.fallos >= FALLOS_ANTES_DE_BLOQUEAR) {
    const exceso = r.fallos - FALLOS_ANTES_DE_BLOQUEAR;
    const espera = Math.min(BLOQUEO_INICIAL_MS * 2 ** exceso, BLOQUEO_MAXIMO_MS);
    r.bloqueadoHasta = Date.now() + espera;
  }
  datos[k] = r;
  guardar(datos);
}

export function limpiarFallos(email: string): void {
  const datos = leer();
  delete datos[llave(email)];
  guardar(datos);
}

export function fallosRestantes(email: string): number {
  const r = leer()[llave(email)];
  return Math.max(0, FALLOS_ANTES_DE_BLOQUEAR - (r?.fallos ?? 0));
}
