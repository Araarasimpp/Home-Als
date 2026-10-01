// src/app/shared/seguridad/clave.ts
// Reglas de contraseña de Home ALS. Las usan registro y "nueva contraseña".
//
// Importante: estas reglas ayudan a la persona a elegir bien, pero un
// atacante puede saltarse la app y llamar a Supabase directo. Por eso las
// mismas reglas mínimas también deben estar activas en Supabase:
// Authentication → Providers → Email (longitud mínima y caracteres requeridos).

export const LONGITUD_MINIMA = 10;

export interface Requisito {
  texto: string;
  ok: boolean;
}

export interface EvaluacionClave {
  /** 0 a 4 */
  puntaje: number;
  nivel: 'vacía' | 'muy débil' | 'débil' | 'aceptable' | 'buena' | 'excelente';
  requisitos: Requisito[];
  /** true cuando cumple todos los requisitos obligatorios */
  valida: boolean;
}

// Contraseñas que se prueban primero en cualquier ataque, más palabras del
// negocio y de Colombia. Se comparan sin mayúsculas, tildes ni números finales.
const COMUNES = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '0123456789', '987654321',
  '111111', '000000', '123123', '112233', '121212', '654321', '666666', '696969',
  'password', 'contrasena', 'clave', 'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl',
  'zxcvbn', 'abc123', 'abcdef', 'abcdefgh', 'iloveyou', 'teamo', 'tequiero', 'amor',
  'admin', 'administrador', 'root', 'usuario', 'user', 'login', 'welcome', 'bienvenido',
  'colombia', 'bogota', 'medellin', 'cali', 'barranquilla', 'nacional', 'millonarios',
  'america', 'junior', 'futbol', 'dios', 'diosesamor', 'jesus', 'princesa', 'familia',
  'homeals', 'home', 'als', 'variedades', 'variedadesjyb', 'jyb', 'tienda', 'pedidos',
  'domicilios', 'domiciliario', 'vendedor', 'despachador', 'inventario', 'kaesuri',
  'superman', 'batman', 'pokemon', 'monkey', 'dragon', 'master', 'shadow', 'sunshine',
]);

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Quita números y símbolos del final: "Colombia2024!" → "colombia" */
function raiz(s: string): string {
  return normalizar(s).replace(/[^a-zñ]+$/i, '').replace(/^[^a-zñ0-9]+/i, '');
}

function esSecuenciaORepeticion(s: string): boolean {
  const n = normalizar(s);
  const sinFinal = n.replace(/[^a-zñ]+$/i, '') || n;
  for (const t of [n, sinFinal]) {
    if (/^(.)\1+$/.test(t)) return true; // aaaaaaaaaa(1)
    if (/^(.{1,6})\1+$/.test(t)) return true; // abc123abc123, 121212
  }
  if (new Set(n).size < 5) return true; // muy pocos caracteres distintos
  const secuencias = ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl'];
  return secuencias.some((sec) => n.length >= 6 && sec.includes(n));
}

/** Partes del nombre y del correo que no deberían aparecer en la contraseña. */
function datosPersonales(nombre = '', email = ''): string[] {
  const partes = [...normalizar(nombre).split(/\s+/), ...normalizar(email.split('@')[0] ?? '').split(/[._\-+0-9]+/)];
  return partes.filter((p) => p.length >= 3);
}

export function evaluarClave(clave: string, contexto: { nombre?: string; email?: string } = {}): EvaluacionClave {
  const n = normalizar(clave);
  const personales = datosPersonales(contexto.nombre, contexto.email);

  const largo = clave.length >= LONGITUD_MINIMA;
  const letrasYNumeros = /[a-zñ]/i.test(clave) && /\d/.test(clave);
  const sinDatos = !personales.some((p) => n.includes(p));
  const noComun =
    clave.length > 0 && !COMUNES.has(n) && !COMUNES.has(raiz(clave)) && !esSecuenciaORepeticion(clave);

  const requisitos: Requisito[] = [
    { texto: `Al menos ${LONGITUD_MINIMA} caracteres`, ok: largo },
    { texto: 'Letras y números', ok: letrasYNumeros },
    { texto: 'Sin tu nombre ni tu correo', ok: clave.length > 0 && sinDatos },
    { texto: 'No es una contraseña común', ok: noComun },
  ];
  const valida = requisitos.every((r) => r.ok);

  if (!clave) return { puntaje: 0, nivel: 'vacía', requisitos, valida: false };

  // Puntaje: combinaciones posibles aproximadas (bits). Repetir caracteres
  // no suma, así que la longitud efectiva se limita por los caracteres distintos.
  const alfabeto =
    (/[a-zñ]/.test(clave) ? 27 : 0) +
    (/[A-ZÑ]/.test(clave) ? 27 : 0) +
    (/\d/.test(clave) ? 10 : 0) +
    (/[^A-Za-zÑñ0-9]/.test(clave) ? 33 : 0);
  const largoEfectivo = Math.min(clave.length, new Set(clave).size * 1.5);
  const bits = largoEfectivo * Math.log2(Math.max(alfabeto, 2));

  let puntaje = bits < 35 ? 0 : bits < 45 ? 1 : bits < 55 ? 2 : bits < 70 ? 3 : 4;
  if (!valida) puntaje = Math.min(puntaje, 1);

  const niveles: EvaluacionClave['nivel'][] = ['muy débil', 'débil', 'aceptable', 'buena', 'excelente'];
  return { puntaje, nivel: niveles[puntaje], requisitos, valida };
}

/**
 * Revisa si la contraseña aparece en filtraciones conocidas (Have I Been Pwned).
 * Usa "k-anonimato": solo se envían los primeros 5 caracteres del hash SHA-1,
 * nunca la contraseña ni el hash completo. Devuelve cuántas veces apareció,
 * 0 si no aparece, o null si no se pudo consultar (sin internet, etc.).
 */
export async function vecesFiltrada(clave: string): Promise<number | null> {
  try {
    const datos = new TextEncoder().encode(clave);
    const hashBuf = await crypto.subtle.digest('SHA-1', datos);
    const hash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const prefijo = hash.slice(0, 5);
    const sufijo = hash.slice(5);

    const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefijo}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!resp.ok) return null;

    const texto = await resp.text();
    for (const linea of texto.split('\n')) {
      const [suf, cuenta] = linea.trim().split(':');
      if (suf === sufijo) return Number(cuenta) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}
