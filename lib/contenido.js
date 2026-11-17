/* ==========================================================================
   lib/contenido.js — Utilidades compartidas por el buscador y el panel admin.
   --------------------------------------------------------------------------
   Este archivo NO es una ruta: vive fuera de functions/ y se importa desde
   las Pages Functions con una ruta relativa.

   Contiene:
     1. Normalización y palabras vacías (para derivar claves).
     2. derivarCategoria(): adivina la categoría a partir del texto.
     3. derivarResumen(): primer párrafo recortado para la tarjeta.
     4. derivarClaves(): palabras más frecuentes.
     5. renderizarContenido(): convierte texto + URLs sueltas en HTML SEGURO.

   Gracias a esto, el formulario del panel solo pide Título y Contenido.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. NORMALIZACIÓN
   -------------------------------------------------------------------------- */

/* Igual que en el buscador: se eliminan acentos y signos para comparar. */
export const PALABRAS_VACIAS = new Set([
  'a', 'al', 'ante', 'bajo', 'como', 'con', 'contra', 'de', 'del',
  'desde', 'donde', 'durante', 'el', 'en', 'entre', 'es', 'esta',
  'este', 'estos', 'estas', 'hacia', 'hasta', 'la', 'las', 'le',
  'les', 'lo', 'los', 'mas', 'me', 'mediante', 'mi', 'mis', 'mucho',
  'muy', 'nuestro', 'nuestra', 'o', 'para', 'pero', 'por', 'que',
  'se', 'segun', 'sin', 'sobre', 'son', 'su', 'sus', 'te', 'tras',
  'tu', 'tus', 'u', 'un', 'una', 'unas', 'uno', 'unos', 'y'
]);

/** Minúsculas, sin acentos ni signos, espacios compactados. */
export function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras significativas de un texto. */
export function tokenizar(texto) {
  return normalizar(texto)
    .split(' ')
    .filter(function (palabra) {
      return palabra.length > 2 && !PALABRAS_VACIAS.has(palabra);
    });
}

/* --------------------------------------------------------------------------
   2. CATEGORÍA AUTOMÁTICA
   -------------------------------------------------------------------------- */

/**
 * 🔧 EDITAR AQUÍ si quieres cambiar las categorías del sitio.
 * Se revisa primero el título (más fiable) y luego el contenido.
 * La primera regla que coincide gana, así que conviene poner las más
 * específicas antes que las generales.
 */
const REGLAS_CATEGORIA = [
  { categoria: 'Demandas',      palabras: ['demanda', 'juicio', 'escrito', 'contestacion', 'litigio'] },
  { categoria: 'Formatos',      palabras: ['formato', 'modelo', 'plantilla', 'ejemplo'] },
  { categoria: 'Jurisprudencia', palabras: ['jurisprudencia', 'tesis', 'criterio', 'ejecutoria', 'sentencia'] },
  { categoria: 'Tratados',      palabras: ['tratado', 'internacional', 'convenio'] },
  { categoria: 'Legislación',   palabras: ['codigo', 'legislacion', 'ordenamiento', 'norma', 'constitucion', 'articulo'] },
  { categoria: 'Pruebas',       palabras: ['prueba', 'pruebas', 'evidencia', 'nomina', 'recibo', 'comprobante'] },
  { categoria: 'Procedimiento', palabras: ['procedimiento', 'provisional', 'tramite', 'plazo', 'medida'] },
  { categoria: 'Práctica',      palabras: ['deudor', 'moroso', 'incumplimiento', 'responsabilidad', 'consecuencia'] },
  { categoria: 'Monto',         palabras: ['monto', 'uma', 'salario', 'minimo', 'porcentaje', 'cantidad', 'calculo'] }
];

/** Devuelve la categoría inferida, o 'Artículo' si ninguna regla coincide. */
export function derivarCategoria(titulo, contenido) {
  const tituloNormal = normalizar(titulo);
  const cuerpoNormal = normalizar(String(contenido || '').slice(0, 600));

  for (const regla of REGLAS_CATEGORIA) {
    if (regla.palabras.some(function (palabra) {
      return tituloNormal.includes(palabra);
    })) return regla.categoria;
  }

  for (const regla of REGLAS_CATEGORIA) {
    if (regla.palabras.some(function (palabra) {
      return cuerpoNormal.includes(palabra);
    })) return regla.categoria;
  }

  return 'Artículo';
}

/* --------------------------------------------------------------------------
   3. RESUMEN AUTOMÁTICO
   -------------------------------------------------------------------------- */

/**
 * Toma el contenido plano, quita URLs y espacios extra y recorta el texto
 * en un límite de palabras para mostrarlo en la tarjeta.
 */
export function derivarResumen(contenido, maximo) {
  const limite = maximo || 240;

  const texto = String(contenido || '')
    .replace(/https?:\/\/[^\s<>"']+/gi, '')  // las URLs se omiten en el resumen
    .replace(/\s+/g, ' ')
    .trim();

  if (texto.length <= limite) return texto;

  const corte = texto.lastIndexOf(' ', limite);
  return texto.slice(0, corte > 0 ? corte : limite).trim() + '…';
}

/* --------------------------------------------------------------------------
   4. CLAVES AUTOMÁTICAS
   -------------------------------------------------------------------------- */

/** Palabras más repetidas (máximo 8), como cadena separada por comas. */
export function derivarClaves(titulo, contenido, maximo) {
  const frecuencias = new Map();

  tokenizar(String(titulo || '') + ' ' + String(contenido || ''))
    .forEach(function (palabra) {
      if (palabra.length < 4) return;
      frecuencias.set(palabra, (frecuencias.get(palabra) || 0) + 1);
    });

  return Array.from(frecuencias.entries())
    .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0], 'es'); })
    .slice(0, maximo || 8)
    .map(function (entrada) { return entrada[0]; })
    .join(', ');
}

/* --------------------------------------------------------------------------
   5. RENDERIZADOR SEGURO DE CONTENIDO CON ENLACES
   -------------------------------------------------------------------------- */

/** Escapa los cinco caracteres especiales de HTML. */
export function escaparHTML(texto) {
  const reemplazos = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  return String(texto).replace(/[&<>"']/g, function (caracter) {
    return reemplazos[caracter];
  });
}

/** Solo se aceptan enlaces http(s); el resto se deja como texto. */
function esUrlValida(texto) {
  try {
    const url = new URL(texto);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

/* Coincide con URLs sueltas. Se excluyen comillas y corchetes para no
   capturar HTML ni terminaores de Markdown. */
const URL_SUELTA = /https?:\/\/[^\s<>"']+/gi;

/**
 * Convierte un párrafo de texto plano en HTML seguro:
 *   - escapa TODO el texto primero;
 *   - detecta URLs sueltas y las envuelve en <a>;
 *   - valida el protocolo con new URL();
 *   - convierte saltos de línea simples en <br>.
 *
 * Nunca se permite HTML escrito por el visitante, así que no hay XSS.
 */
function renderizarParrafo(texto) {
  let resultado = '';
  let ultimoIndice = 0;
  let coincidencia;

  URL_SUELTA.lastIndex = 0;

  while ((coincidencia = URL_SUELTA.exec(texto)) !== null) {
    const encontrado = coincidencia[0];

    /* Quitar signos de puntuación pegados al final de la URL. */
    let longitud = encontrado.length;
    while (/[.,;:!?)\]}]+$/.test(encontrado.slice(0, longitud))) longitud--;

    if (longitud <= 0) continue;

    const url = encontrado.slice(0, longitud);
    const sobrante = encontrado.slice(longitud);

    /* Texto anterior a la URL. */
    resultado += escaparHTML(texto.slice(ultimoIndice, coincidencia.index))
      .replace(/\n/g, '<br>');

    if (esUrlValida(url)) {
      resultado +=
        '<a href="' + escaparHTML(url) + '"' +
        ' target="_blank" rel="noopener noreferrer">' +
        escaparHTML(url) +
        '</a>';
    } else {
      resultado += escaparHTML(url);
    }

    resultado += escaparHTML(sobrante);
    ultimoIndice = coincidencia.index + encontrado.length;
  }

  /* Texto restante después de la última URL. */
  resultado += escaparHTML(texto.slice(ultimoIndice)).replace(/\n/g, '<br>');

  return resultado;
}

/**
 * Convierte el contenido completo en párrafos HTML seguros.
 * Se usa tanto en los resultados como en la vista previa del admin.
 */
export function renderizarContenido(contenido) {
  return String(contenido || '')
    .split(/\n\s*\n/)
    .map(function (parrafo) { return parrafo.trim(); })
    .filter(Boolean)
    .map(function (parrafo) {
      return '<p>' + renderizarParrafo(parrafo) + '</p>';
    })
    .join('');
}
