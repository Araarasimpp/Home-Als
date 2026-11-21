// Secciones del riel de escritorio (y del menú "Más" en el celular) por rol.
import { PaginaNav, SeccionNav } from './nav-escritorio.component';

function atajos(base: string, conCuadres: boolean): PaginaNav[] {
  const a: PaginaNav[] = [
    { label: 'Por alistar', path: `${base}/pedidos`, icon: 'cube-outline', conteo: 'porAlistar', query: { estado: 'pendiente' }, atajo: true },
    { label: 'Alistados', path: `${base}/pedidos`, icon: 'checkmark-circle-outline', conteo: 'alistados', query: { estado: 'alistado' }, atajo: true },
    { label: 'En ruta', path: `${base}/pedidos`, icon: 'bicycle-outline', conteo: 'enRuta', query: { estado: 'en_ruta' }, atajo: true },
  ];
  if (conCuadres) {
    a.push({ label: 'Cuadres por confirmar', path: `${base}/cuadres`, icon: 'wallet-outline', conteo: 'cuadres', atajo: true });
  }
  return a;
}

export const SECCIONES_ADMIN: SeccionNav[] = [
  {
    id: 'inicio', label: 'Inicio', icon: 'home-outline', subtitulo: 'Cómo va el negocio hoy',
    paginas: [{ label: 'Resumen', path: '/admin', icon: 'home-outline' }, ...atajos('/admin', true)],
  },
  {
    id: 'ventas', label: 'Ventas', icon: 'receipt-outline', subtitulo: 'Pedidos, ventas en el local y clientes',
    paginas: [
      { label: 'Pedidos', path: '/admin/pedidos', icon: 'receipt-outline', conteo: 'porAlistar' },
      { label: 'Venta en local', path: '/admin/venta-local', icon: 'storefront-outline' },
      { label: 'Ventas del local', path: '/admin/ventas-del-local', icon: 'list-outline' },
      { label: 'Clientes', path: '/admin/clientes', icon: 'people-circle-outline' },
    ],
  },
  {
    id: 'dinero', label: 'Dinero', icon: 'wallet-outline', subtitulo: 'Cuadres de los domiciliarios y reportes',
    paginas: [
      { label: 'Cuadres', path: '/admin/cuadres', icon: 'wallet-outline', conteo: 'cuadres' },
      { label: 'Reportes', path: '/admin/reportes', icon: 'bar-chart-outline' },
    ],
  },
  {
    id: 'catalogo', label: 'Catálogo', icon: 'cube-outline', subtitulo: 'Productos, precios y stock',
    paginas: [{ label: 'Productos', path: '/admin/productos', icon: 'cube-outline' }],
  },
  {
    id: 'equipo', label: 'Equipo', icon: 'people-outline', subtitulo: 'Personas, metas y actividad',
    paginas: [
      { label: 'Usuarios', path: '/admin/usuarios', icon: 'people-outline' },
      { label: 'Ranking', path: '/admin/ranking', icon: 'trophy-outline' },
      { label: 'Actividad', path: '/admin/actividad', icon: 'time-outline' },
    ],
  },
  {
    id: 'ajustes', label: 'Ajustes', icon: 'settings-outline', subtitulo: 'La tienda y tu cuenta', abajo: true,
    paginas: [
      { label: 'Configuración', path: '/admin/configuracion', icon: 'settings-outline' },
      { label: 'Mi seguridad', path: '/admin/seguridad', icon: 'shield-checkmark-outline' },
      { label: 'Mi perfil', path: '/admin/perfil', icon: 'person-circle-outline' },
    ],
  },
];

export const SECCIONES_DESPACHADOR: SeccionNav[] = [
  {
    id: 'inicio', label: 'Inicio', icon: 'home-outline', subtitulo: 'Cómo va el despacho hoy',
    paginas: [{ label: 'Resumen', path: '/despachador', icon: 'home-outline' }, ...atajos('/despachador', true)],
  },
  {
    id: 'ventas', label: 'Ventas', icon: 'receipt-outline', subtitulo: 'Pedidos y ventas en el local',
    paginas: [
      { label: 'Pedidos', path: '/despachador/pedidos', icon: 'receipt-outline', conteo: 'porAlistar' },
      { label: 'Venta en local', path: '/despachador/venta-local', icon: 'storefront-outline' },
      { label: 'Ventas del local', path: '/despachador/ventas-del-local', icon: 'list-outline' },
    ],
  },
  {
    id: 'dinero', label: 'Dinero', icon: 'wallet-outline', subtitulo: 'Cuadres de los domiciliarios',
    paginas: [{ label: 'Cuadres', path: '/despachador/cuadres', icon: 'wallet-outline', conteo: 'cuadres' }],
  },
  {
    id: 'equipo', label: 'Equipo', icon: 'people-outline', subtitulo: 'Cómo van los domiciliarios',
    paginas: [{ label: 'Ranking', path: '/despachador/ranking', icon: 'trophy-outline' }],
  },
  {
    id: 'ajustes', label: 'Ajustes', icon: 'settings-outline', subtitulo: 'Tu cuenta', abajo: true,
    paginas: [{ label: 'Mi perfil', path: '/despachador/perfil', icon: 'person-circle-outline' }],
  },
];
