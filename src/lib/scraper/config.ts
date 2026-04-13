import type { ScraperConfig, ScraperSelectors, ScraperCategory } from "./types";

/**
 * Available categories from Jotakp (Cappelletti Informática)
 */
export const jotakpCategories: ScraperCategory[] = [
  // Almacenamiento
  { id: "almacenamiento", name: "Almacenamiento", idsubrubro1: 0, parentId: null },
  { id: "carry-caddy-disk", name: "Carry-Caddy Disk", idsubrubro1: 100, parentId: "almacenamiento" },
  { id: "cd-dvd-bluray", name: "CD-DVD-BluRay-Dual Layer", idsubrubro1: 13, parentId: "almacenamiento" },
  { id: "discos-externos", name: "Discos Externos", idsubrubro1: 14, parentId: "almacenamiento" },
  { id: "discos-hdd", name: "Discos HDD", idsubrubro1: 69, parentId: "almacenamiento" },
  { id: "discos-m2", name: "Discos M.2", idsubrubro1: 157, parentId: "almacenamiento" },
  { id: "discos-ssd", name: "Discos SSD", idsubrubro1: 156, parentId: "almacenamiento" },
  { id: "memorias-flash", name: "Memorias Flash", idsubrubro1: 12, parentId: "almacenamiento" },
  { id: "pendrive", name: "Pendrive", idsubrubro1: 5, parentId: "almacenamiento" },

  // Audio
  { id: "audio", name: "Audio", idsubrubro1: 0, parentId: null },
  { id: "auricular-bluetooth", name: "Auricular Bluetooth", idsubrubro1: 149, parentId: "audio" },
  { id: "auricular-cableado", name: "Auricular Cableado", idsubrubro1: 36, parentId: "audio" },
  { id: "conversores-adaptadores-audio", name: "Conversores y Adaptadores", idsubrubro1: 122, parentId: "audio" },
  { id: "microfonos", name: "Microfonos", idsubrubro1: 45, parentId: "audio" },
  { id: "parlantes", name: "Parlantes", idsubrubro1: 35, parentId: "audio" },
  { id: "placas-de-sonido", name: "Placas de Sonido", idsubrubro1: 46, parentId: "audio" },
  { id: "reproductor-cd-dvd-mp3", name: "Reproductor CD-DVD-MP3-Vinilo", idsubrubro1: 126, parentId: "audio" },
  { id: "sintonizadores", name: "Sintonizadores", idsubrubro1: 38, parentId: "audio" },

  // Cables
  { id: "cables", name: "Cables", idsubrubro1: 0, parentId: null },
  { id: "cable-audio", name: "Cable Audio", idsubrubro1: 140, parentId: "cables" },
  { id: "cable-celulares", name: "Cable Celulares", idsubrubro1: 141, parentId: "cables" },
  { id: "cable-energia", name: "Cable Energia", idsubrubro1: 142, parentId: "cables" },
  { id: "cable-hardware", name: "Cable Hardware", idsubrubro1: 145, parentId: "cables" },
  { id: "cable-impresora", name: "Cable Impresora", idsubrubro1: 143, parentId: "cables" },
  { id: "cable-video", name: "Cable Video", idsubrubro1: 144, parentId: "cables" },

  // Computadoras
  { id: "computadoras", name: "Computadoras", idsubrubro1: 0, parentId: null },
  { id: "accesorios-computadoras", name: "Accesorios", idsubrubro1: 118, parentId: "computadoras" },
  { id: "aio", name: "AIO", idsubrubro1: 58, parentId: "computadoras" },
  { id: "bases-notebook", name: "Bases de Notebook", idsubrubro1: 64, parentId: "computadoras" },
  { id: "cargadores-computadoras", name: "Cargadores", idsubrubro1: 63, parentId: "computadoras" },
  { id: "fundas-mochilas-bolsos", name: "Fundas-Mochilas-Bolsos", idsubrubro1: 65, parentId: "computadoras" },
  { id: "licencias-servidores", name: "Licencias y Servidores", idsubrubro1: 103, parentId: "computadoras" },
  { id: "mini-pc", name: "Mini Pc", idsubrubro1: 59, parentId: "computadoras" },
  { id: "notebooks", name: "Notebooks", idsubrubro1: 56, parentId: "computadoras" },
  { id: "pantallas-computadoras", name: "Pantallas", idsubrubro1: 62, parentId: "computadoras" },
  { id: "pc", name: "Pc", idsubrubro1: 60, parentId: "computadoras" },
  { id: "servidores", name: "Servidores", idsubrubro1: 119, parentId: "computadoras" },
  { id: "soportes-computadoras", name: "Soportes", idsubrubro1: 66, parentId: "computadoras" },
  { id: "tablets", name: "Tablets", idsubrubro1: 57, parentId: "computadoras" },

  // Conectividad
  { id: "conectividad", name: "Conectividad", idsubrubro1: 0, parentId: null },
  { id: "antenas", name: "Antenas", idsubrubro1: 72, parentId: "conectividad" },
  { id: "conectores", name: "Conectores", idsubrubro1: 80, parentId: "conectividad" },
  { id: "extensores", name: "Extensores", idsubrubro1: 73, parentId: "conectividad" },
  { id: "patch-cord", name: "Patch Cord", idsubrubro1: 112, parentId: "conectividad" },
  { id: "patch-panel", name: "Patch Panel", idsubrubro1: 170, parentId: "conectividad" },
  { id: "placas-de-red", name: "Placas de Red", idsubrubro1: 75, parentId: "conectividad" },
  { id: "puntos-de-acceso", name: "Puntos de Acceso", idsubrubro1: 71, parentId: "conectividad" },
  { id: "rack", name: "Rack", idsubrubro1: 78, parentId: "conectividad" },
  { id: "routers", name: "Routers", idsubrubro1: 70, parentId: "conectividad" },
  { id: "switches", name: "Switches", idsubrubro1: 74, parentId: "conectividad" },
  { id: "utp-ftp", name: "UTP-FTP", idsubrubro1: 113, parentId: "conectividad" },

  // Energia
  { id: "energia", name: "Energia", idsubrubro1: 0, parentId: null },
  { id: "adaptador-energia", name: "Adaptador", idsubrubro1: 160, parentId: "energia" },
  { id: "baterias", name: "Baterias", idsubrubro1: 52, parentId: "energia" },
  { id: "cargadores-energia", name: "Cargadores", idsubrubro1: 51, parentId: "energia" },
  { id: "estabilizadores", name: "Estabilizadores", idsubrubro1: 54, parentId: "energia" },
  { id: "led", name: "Led", idsubrubro1: 55, parentId: "energia" },
  { id: "linterna", name: "Linterna", idsubrubro1: 146, parentId: "energia" },
  { id: "pilas", name: "Pilas", idsubrubro1: 50, parentId: "energia" },
  { id: "ups", name: "Ups", idsubrubro1: 53, parentId: "energia" },
  { id: "zapatillas", name: "Zapatillas", idsubrubro1: 102, parentId: "energia" },

  // Gaming
  { id: "gaming", name: "Gaming", idsubrubro1: 0, parentId: null },
  { id: "accesorios-gaming", name: "Accesorios", idsubrubro1: 89, parentId: "gaming" },
  { id: "auricular-gamer", name: "Auricular Gamer", idsubrubro1: 154, parentId: "gaming" },
  { id: "combo-gamer", name: "Combo Gamer", idsubrubro1: 161, parentId: "gaming" },
  { id: "consolas", name: "Consolas", idsubrubro1: 88, parentId: "gaming" },
  { id: "joysticks", name: "Joysticks", idsubrubro1: 90, parentId: "gaming" },
  { id: "mouse-gamer", name: "Mouse Gamer", idsubrubro1: 152, parentId: "gaming" },
  { id: "silla-gamer", name: "Silla Gamer", idsubrubro1: 147, parentId: "gaming" },
  { id: "teclado-gamer", name: "Teclado Gamer", idsubrubro1: 153, parentId: "gaming" },

  // Hardware
  { id: "hardware", name: "Hardware", idsubrubro1: 0, parentId: null },
  { id: "conversores-adaptadores-hardware", name: "Conversores y Adaptadores", idsubrubro1: 125, parentId: "hardware" },
  { id: "coolers-disipadores", name: "Coolers y Disipadores", idsubrubro1: 34, parentId: "hardware" },
  { id: "fuentes", name: "Fuentes", idsubrubro1: 9, parentId: "hardware" },
  { id: "gabinetes", name: "Gabinetes", idsubrubro1: 10, parentId: "hardware" },
  { id: "grabadoras", name: "Grabadoras", idsubrubro1: 11, parentId: "hardware" },
  { id: "memorias", name: "Memorias", idsubrubro1: 1, parentId: "hardware" },
  { id: "memorias-notebooks", name: "Memorias Notebooks", idsubrubro1: 158, parentId: "hardware" },
  { id: "microprocesadores", name: "Microprocesadores", idsubrubro1: 6, parentId: "hardware" },
  { id: "motherboard", name: "Motherboard", idsubrubro1: 7, parentId: "hardware" },
  { id: "placas-de-video", name: "Placas de Video", idsubrubro1: 8, parentId: "hardware" },

  // Imagen
  { id: "imagen", name: "Imagen", idsubrubro1: 0, parentId: null },
  { id: "camaras-filmadoras", name: "Camaras y Filmadoras", idsubrubro1: 16, parentId: "imagen" },
  { id: "conversores-adaptadores-imagen", name: "Conversores y Adaptadores", idsubrubro1: 123, parentId: "imagen" },
  { id: "monitores-tv", name: "Monitores-TV", idsubrubro1: 15, parentId: "imagen" },
  { id: "pantallas-imagen", name: "Pantallas", idsubrubro1: 30, parentId: "imagen" },
  { id: "proyectores", name: "Proyectores", idsubrubro1: 29, parentId: "imagen" },
  { id: "scanner", name: "Scanner", idsubrubro1: 48, parentId: "imagen" },
  { id: "sintonizadora", name: "Sintonizadora", idsubrubro1: 128, parentId: "imagen" },
  { id: "smartwatch", name: "Smartwatch", idsubrubro1: 109, parentId: "imagen" },
  { id: "soportes-imagen", name: "Soportes", idsubrubro1: 28, parentId: "imagen" },
  { id: "streaming", name: "Streaming", idsubrubro1: 31, parentId: "imagen" },

  // Impresion
  { id: "impresion", name: "Impresion", idsubrubro1: 0, parentId: null },
  { id: "impresion-3d", name: "3D", idsubrubro1: 167, parentId: "impresion" },
  { id: "cajas-cd-dvd-bluray", name: "Cajas CD-DVD-BLURAY", idsubrubro1: 41, parentId: "impresion" },
  { id: "cartuchos-alternativos", name: "Cartuchos Alternativos", idsubrubro1: 21, parentId: "impresion" },
  { id: "cartuchos-originales", name: "Cartuchos Originales", idsubrubro1: 19, parentId: "impresion" },
  { id: "cintas-impresion", name: "Cintas Para Impresion", idsubrubro1: 24, parentId: "impresion" },
  { id: "impresoras", name: "Impresoras", idsubrubro1: 17, parentId: "impresion" },
  { id: "resmas", name: "Resmas", idsubrubro1: 25, parentId: "impresion" },
  { id: "tintas-alternativas", name: "Tintas Alternativas", idsubrubro1: 27, parentId: "impresion" },
  { id: "tintas-originales", name: "Tintas Originales", idsubrubro1: 26, parentId: "impresion" },
  { id: "toners-alternativos", name: "Toners Alternativos", idsubrubro1: 23, parentId: "impresion" },
  { id: "toners-alternativos-outlet", name: "Toners Alternativos Outlet", idsubrubro1: 168, parentId: "impresion" },
  { id: "toners-originales", name: "Toners Originales", idsubrubro1: 22, parentId: "impresion" },
  { id: "toners-originales-outlet", name: "Toners Originales Outlet", idsubrubro1: 162, parentId: "impresion" },

  // OUTLET
  { id: "outlet", name: "OUTLET", idsubrubro1: 88, parentId: null },

  // Perifericos
  { id: "perifericos", name: "Perifericos", idsubrubro1: 0, parentId: null },
  { id: "lectores", name: "Lectores", idsubrubro1: 79, parentId: "perifericos" },
  { id: "mouse-perifericos", name: "Mouse", idsubrubro1: 43, parentId: "perifericos" },
  { id: "pad", name: "Pad", idsubrubro1: 49, parentId: "perifericos" },
  { id: "tableta-grafica", name: "Tableta Grafica y Presentadores", idsubrubro1: 106, parentId: "perifericos" },
  { id: "teclados-perifericos", name: "Teclados", idsubrubro1: 44, parentId: "perifericos" },
  { id: "ventilador-usb", name: "Ventilador USB", idsubrubro1: 107, parentId: "perifericos" },
  { id: "webcams", name: "Webcams", idsubrubro1: 67, parentId: "perifericos" },

  // Seguridad
  { id: "seguridad", name: "Seguridad", idsubrubro1: 0, parentId: null },
  { id: "accesorios-seguridad", name: "Accesorios", idsubrubro1: 93, parentId: "seguridad" },
  { id: "alarmas", name: "Alarmas", idsubrubro1: 134, parentId: "seguridad" },
  { id: "alarmas-accesorios", name: "Alarmas - Accesorios", idsubrubro1: 163, parentId: "seguridad" },
  { id: "balun", name: "Balun", idsubrubro1: 159, parentId: "seguridad" },
  { id: "camaras-cctv", name: "Camaras CCTV", idsubrubro1: 82, parentId: "seguridad" },
  { id: "camaras-ip", name: "Camaras IP", idsubrubro1: 136, parentId: "seguridad" },
  { id: "control-de-acceso", name: "Control de Acceso", idsubrubro1: 135, parentId: "seguridad" },
  { id: "dvr-nvr", name: "DVR-NVR", idsubrubro1: 86, parentId: "seguridad" },
  { id: "fuentes-seguridad", name: "Fuentes", idsubrubro1: 164, parentId: "seguridad" },
  { id: "kit-seguridad", name: "Kit Seguridad", idsubrubro1: 165, parentId: "seguridad" },
  { id: "porteria", name: "Porteria", idsubrubro1: 169, parentId: "seguridad" },
  { id: "soporte-seguridad", name: "Soporte", idsubrubro1: 171, parentId: "seguridad" },

  // Telefonia
  { id: "telefonia", name: "Telefonia", idsubrubro1: 0, parentId: null },
  { id: "accesorios-telefonia", name: "Accesorios", idsubrubro1: 99, parentId: "telefonia" },
  { id: "celulares", name: "Celulares", idsubrubro1: 92, parentId: "telefonia" },
  { id: "centrales-telefonicas", name: "Centrales Telefonicas", idsubrubro1: 95, parentId: "telefonia" },
  { id: "telefonos", name: "Telefonos", idsubrubro1: 91, parentId: "telefonia" },

  // Varios
  { id: "varios", name: "Varios", idsubrubro1: 0, parentId: null },
  { id: "armado-testeo-pc", name: "Armado y Testeo de PC", idsubrubro1: 85, parentId: "varios" },
  { id: "electro", name: "Electro", idsubrubro1: 121, parentId: "varios" },
  { id: "herramientas", name: "Herramientas", idsubrubro1: 97, parentId: "varios" },
  { id: "limpieza-mantenimiento", name: "Limpieza y Mantenimiento", idsubrubro1: 96, parentId: "varios" },
  { id: "navajas-cuchillos", name: "Navajas y Cuchillos", idsubrubro1: 132, parentId: "varios" },
  { id: "oficina", name: "Oficina", idsubrubro1: 166, parentId: "varios" },
  { id: "outlet-varios", name: "Outlet", idsubrubro1: 133, parentId: "varios" },
];

/**
 * Default selectors for Jotakp supplier
 */
const defaultSelectors: ScraperSelectors = {
  login: {
    formSelector: "#form1",
    emailInputSelector: "#ContentPlaceHolder1_txtUsuario, #txtUsuario, #TxtEmail",
    passwordInputSelector: "#ContentPlaceHolder1_txtClave, #txtClave, #TxtPass1",
    submitButtonSelector: "#ContentPlaceHolder1_btnIngresar, #btnIngresar, #BtnIngresar",
  },
  productList: {
    containerSelector: "body",
    itemSelector: "a[href*='articulo.aspx?id=']",
    nextPageSelector: "",
  },
  product: {
    nameSelector: "",
    priceSelector: "",
    descriptionSelector: "",
    imageSelector: "img",
    skuSelector: "",
    stockSelector: "",
    linkSelector: "a[href*='articulo.aspx?id=']",
  },
  pagination: {
    pageParam: "idsubrubro1",
    maxPages: 20,
  },
};

/**
 * Get scraper configuration from environment variables
 */
export function getScraperConfig(): ScraperConfig {
  const SUPPLIER_URL = process.env.SUPPLIER_URL || "https://jotakp.dyndns.org";
  const SUPPLIER_LOGIN_URL = process.env.SUPPLIER_LOGIN_URL || "http://jotakp.dyndns.org/loginext.aspx";
  const SUPPLIER_EMAIL = process.env.SUPPLIER_EMAIL || "20418216795";
  const SUPPLIER_PASSWORD = process.env.SUPPLIER_PASSWORD || "123456";

  if (!SUPPLIER_URL) {
    throw new Error("SUPPLIER_URL is required in environment variables");
  }
  if (!SUPPLIER_LOGIN_URL) {
    throw new Error("SUPPLIER_LOGIN_URL is required in environment variables");
  }
  if (!SUPPLIER_EMAIL) {
    throw new Error("SUPPLIER_EMAIL is required in environment variables");
  }
  if (!SUPPLIER_PASSWORD) {
    throw new Error("SUPPLIER_PASSWORD is required in environment variables");
  }

  // Extract supplier name from URL
  const supplierName = SUPPLIER_URL
    .replace(/^https?:\/\//, "")
    .replace(/\..*/, "")
    .toLowerCase();

  return {
    supplier: supplierName,
    baseUrl: SUPPLIER_URL,
    loginUrl: SUPPLIER_LOGIN_URL,
    email: SUPPLIER_EMAIL,
    password: SUPPLIER_PASSWORD,
    delayMs: parseInt(process.env.SUPPLIER_DELAY_MS || "3000", 10),
    selectors: defaultSelectors,
  };
}

/**
 * Update selectors after site exploration
 */
export function updateSelectors(newSelectors: Partial<ScraperSelectors>): void {
  defaultSelectors.login = { ...defaultSelectors.login, ...newSelectors.login };
  defaultSelectors.productList = { ...defaultSelectors.productList, ...newSelectors.productList };
  defaultSelectors.product = { ...defaultSelectors.product, ...newSelectors.product };
  defaultSelectors.pagination = { ...defaultSelectors.pagination, ...newSelectors.pagination };
}