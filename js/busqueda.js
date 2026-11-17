/* ==========================================================================
   busqueda.js — Buscador del sitio conectado a Cloudflare D1.
   --------------------------------------------------------------------------
   Antes este archivo construía un índice local con las secciones de
   index.html y el arreglo js/paginas.js. Ahora ya no hay índice local:

     navegador  --fetch-->  /api/buscar?q=...  --D1/FTS5-->  JSON

   Flujo completo:
     1. El visitante escribe (con un pequeño retardo / debounce).
     2. Se cancela la petición anterior si todavía estaba en curso.
     3. Se muestra un estado de carga.
     4. Llega el JSON y se pintan las tarjetas, resaltando coincidencias.
     5. Si falla la conexión, se muestra un estado de error con reintento.

   La búsqueda (relevancia, acentos, prefijos) la hace FTS5 en el servidor.
   El navegador solo resalta y presenta. Todo el código está comentado.
   ========================================================================== */

'use strict';

(function () {
  /* ------------------------------------------------------------------------
     1. REFERENCIAS DEL DOM
     ------------------------------------------------------------------------ */

  const formulario = document.getElementById('form-buscador');
  const campo = document.getElementById('campo-busqueda');
  const botonLimpiar = document.getElementById('boton-limpiar');
  const seccionResultados = document.getElementById('resultados');
  const lista = document.getElementById('lista-resultados');
  const estado = document.getElementById('estado-busqueda');
  const vacio = document.getElementById('resultados-vacio');
  const consultaVacia = document.getElementById('consulta-vacia');
  const botonVolver = document.getElementById('boton-volver');
  const tituloResultados = document.getElementById('titulo-resultados');

  /* Elementos nuevos: carga, error y reintento. */
  const cargando = document.getElementById('resultados-cargando');
  const bloqueError = document.getElementById('resultados-error');
  const botonReintentar = document.getElementById('boton-reintentar');

  /* Si falta algún elemento esencial, el buscador no se inicializa. */
  if (!formulario || !campo || !seccionResultados || !lista) return;

  /* ------------------------------------------------------------------------
     2. CONFIGURACIÓN
     ------------------------------------------------------------------------ */

  /* Ruta de la Pages Function definida en functions/api/buscar.js.
     Al estar en el mismo origen no se necesita CORS ni una URL absoluta. */
  const API_URL = '/api/buscar';

  const MAX_RESULTADOS = 20;
  const MIN_CARACTERES = 2;
  const RETARDO = 220;

  /* Palabras vacías que se descartan también en el cliente, para que el
     resaltado use los mismos términos que la consulta enviada al servidor. */
  const PALABRAS_VACIAS = new Set([
    'a', 'al', 'ante', 'bajo', 'como', 'con', 'contra', 'de', 'del',
    'desde', 'donde', 'durante', 'el', 'en', 'entre', 'es', 'esta',
    'este', 'estos', 'estas', 'hacia', 'hasta', 'la', 'las', 'le',
    'les', 'lo', 'los', 'mas', 'me', 'mediante', 'mi', 'mis', 'mucho',
    'muy', 'nuestro', 'nuestra', 'o', 'para', 'pero', 'por', 'que',
    'se', 'segun', 'sin', 'sobre', 'son', 'su', 'sus', 'te', 'tras',
    'tu', 'tus', 'u', 'un', 'una', 'unas', 'uno', 'unos', 'y'
  ]);

  /* Variantes de acento para resaltar el texto original sin perder tildes. */
  const ACENTOS = {
    a: 'aáàäâã',
    e: 'eéèëê',
    i: 'iíìïî',
    o: 'oóòöôõ',
    u: 'uúùüû',
    n: 'nñ'
  };

  /* ------------------------------------------------------------------------
     3. ESTADO INTERNO
     ------------------------------------------------------------------------ */

  let temporizador = null;        /* Retardo de la escritura. */
  let controlador = null;         /* AbortController de la petición activa. */
  let idPeticion = 0;             /* Para descartar respuestas obsoletas. */
  let ultimaConsulta = '';        /* Se usa al reintentar tras un error. */
  let tarjetaAbierta = null;      /* Solo una tarjeta desplegada a la vez. */

  /* ------------------------------------------------------------------------
     4. UTILIDADES DE TEXTO (solo para mostrar/resaltar)
     ------------------------------------------------------------------------ */

  /**
   * Minúsculas, sin acentos ni signos, espacios compactados.
   * Debe coincidir con la función normalizar() del servidor.
   */
  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Convierte la consulta en palabras significativas. */
  function tokenizar(texto) {
    return normalizar(texto)
      .split(' ')
      .filter(function (palabra) {
        return palabra.length > 1 && !PALABRAS_VACIAS.has(palabra);
      });
  }

  /** Escapa caracteres especiales antes de insertar texto en HTML. */
  function escaparHTML(texto) {
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

  /** Escapa un texto para usarlo dentro de una expresión regular. */
  function escaparRegex(texto) {
    return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Genera variantes singular/plural para resaltar "demanda"/"demandas". */
  function variantesDeToken(token) {
    const variantes = [token];

    if (token.length > 4) {
      if (token.endsWith('s')) {
        variantes.push(token.slice(0, -1));
      } else {
        variantes.push(token + 's');
      }
    }

    return variantes;
  }

  /** Expresión regular que encuentra las palabras buscadas con o sin acento. */
  function crearPatron(tokens) {
    if (!tokens.length) return null;

    const variantes = [];

    tokens.forEach(function (token) {
      variantesDeToken(token).forEach(function (variante) {
        if (!variantes.includes(variante)) variantes.push(variante);
      });
    });

    variantes.sort(function (a, b) { return b.length - a.length; });

    const partes = variantes.map(function (token) {
      let patron = '';

      for (const caracter of token) {
        const equivalentes = ACENTOS[caracter];
        patron += equivalentes
          ? '[' + equivalentes + ']'
          : escaparRegex(caracter);
      }

      return patron;
    });

    return new RegExp('(' + partes.join('|') + ')', 'gi');
  }

  /** Escapa el texto y envuelve las coincidencias en <mark>. */
  function resaltar(texto, tokens) {
    const patron = crearPatron(tokens);

    if (!patron) return escaparHTML(texto);

    const piezas = [];
    let ultimoIndice = 0;
    let coincidencia;

    while ((coincidencia = patron.exec(texto)) !== null) {
      if (coincidencia.index > ultimoIndice) {
        piezas.push(escaparHTML(texto.slice(ultimoIndice, coincidencia.index)));
      }

      piezas.push('<mark>' + escaparHTML(coincidencia[0]) + '</mark>');
      ultimoIndice = patron.lastIndex;

      if (coincidencia[0].length === 0) patron.lastIndex += 1;
    }

    piezas.push(escaparHTML(texto.slice(ultimoIndice)));
    return piezas.join('');
  }

  /** Recorta el texto alrededor de la primera coincidencia y lo resalta. */
  function crearExtracto(texto, tokens, maximo) {
    const limite = maximo || 210;
    const patron = crearPatron(tokens);
    let coincidencia = null;

    if (patron) coincidencia = patron.exec(texto);

    let inicio = 0;
    let fin = Math.min(texto.length, limite);

    if (coincidencia) {
      inicio = Math.max(0, coincidencia.index - 64);

      if (inicio > 0) {
        const siguienteEspacio = texto.indexOf(' ', inicio);
        if (siguienteEspacio !== -1 && siguienteEspacio < coincidencia.index) {
          inicio = siguienteEspacio + 1;
        }
      }

      fin = Math.min(texto.length, inicio + limite);

      if (fin < texto.length) {
        const ultimoEspacio = texto.lastIndexOf(' ', fin);
        if (ultimoEspacio > inicio) fin = ultimoEspacio;
      }
    }

    let extracto = texto.slice(inicio, fin).trim();

    if (inicio > 0) extracto = '…' + extracto;
    if (fin < texto.length) extracto += '…';

    return resaltar(extracto, tokens);
  }

  /**
   * Valida la URL que viene de la base de datos antes de ponerla en un href.
   * Solo se permiten rutas relativas, anclas y http(s).
   * Devuelve '' cuando no hay enlace válido (entonces se usa <details>).
   */
  function urlSegura(valor) {
    const texto = String(valor || '').trim();

    if (!texto || texto === '#') return '';
    if (/^(https?:\/\/|\/|\.\/|#)/i.test(texto)) return texto;
    return '';
  }

  /* ------------------------------------------------------------------------
     5. PETICIÓN A LA BASE DE DATOS (a través del endpoint)
     ------------------------------------------------------------------------ */

  /** Normaliza una fila del JSON al formato que espera la interfaz. */
  function normalizarEntrada(fila) {
    return {
      id: fila.id,
      titulo: String(fila.titulo || ''),
      categoria: String(fila.categoria || 'Artículo'),
      resumen: String(fila.resumen || ''),
      contenido: String(fila.contenido || ''),
      /* HTML ya escapado y con enlaces, generado por el servidor. */
      contenidoHtml: String(fila.contenido_html || ''),
      url: String(fila.url || '')
    };
  }

  /**
   * Pide los resultados al servidor.
   * Cancela la petición anterior para que una respuesta lenta nunca sobrescriba
   * a una búsqueda más reciente.
   */
  async function buscarEnServidor(texto) {
    if (controlador) controlador.abort();
    controlador = new AbortController();

    const idActual = ++idPeticion;

    const url = new URL(API_URL, window.location.origin);
    url.searchParams.set('q', texto);
    url.searchParams.set('limite', String(MAX_RESULTADOS));

    const respuesta = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controlador.signal,
      cache: 'no-store'
    });

    if (!respuesta.ok) {
      throw new Error('Respuesta HTTP ' + respuesta.status);
    }

    const datos = await respuesta.json();

    /* Si mientras tanto se hizo otra búsqueda, esta respuesta ya no sirve. */
    if (idActual !== idPeticion) return null;

    if (datos && datos.error) {
      throw new Error(datos.error);
    }

    const filas = datos && Array.isArray(datos.resultados)
      ? datos.resultados
      : [];

    return {
      tokens: tokenizar(texto),
      encontrados: filas.map(normalizarEntrada)
    };
  }

  /* ------------------------------------------------------------------------
     6. PRESENTACIÓN (tarjetas y estados)
     ------------------------------------------------------------------------ */

  /** Icono de flecha reutilizable para el enlace al artículo. */
  const FLECHA =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">' +
      '<path d="M5 12h14M13 6l6 6-6 6"/>' +
    '</svg>';

  /** Chevron del acordeón; gira cuando la tarjeta está abierta. */
  const CHEVRON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">' +
      '<path d="m6 9 6 6 6-6"/>' +
    '</svg>';

  /**
   * Construye una tarjeta de resultado.
   * La cabecera despliega un fragmento; el enlace abre el artículo completo
   * en /articulo?id=... . Todo el texto se escapa antes de insertarse.
   */
  function crearHTMLResultado(entrada, tokens, consulta, indice) {
    const id = Number(entrada.id) > 0 ? Number(entrada.id) : 0;
    const detalleId = 'detalle-' + (id || 'fila-' + indice);
    const categoria = escaparHTML(entrada.categoria);
    const titulo = resaltar(entrada.titulo || 'Sin título', tokens);
    const textoBase = entrada.resumen || entrada.contenido;
    const extracto = crearExtracto(textoBase, tokens, 210);
    const fragmento = crearExtracto(entrada.contenido || textoBase, tokens, 620);
    const url = urlSegura(entrada.url);

    const parametros = new URLSearchParams();
    if (id) parametros.set('id', String(id));
    if (consulta) parametros.set('q', consulta);
    const hrefArticulo = id ? '/articulo?' + parametros.toString() : '';

    let enlaces = '';

    if (hrefArticulo) {
      enlaces +=
        '<a class="tarjeta__abrir" href="' + escaparHTML(hrefArticulo) + '">' +
          '<span>Leer artículo completo</span>' + FLECHA +
        '</a>';
    }

    if (url) {
      enlaces +=
        '<a class="tarjeta__fuente" href="' + escaparHTML(url) + '">' +
          'Abrir enlace original' +
        '</a>';
    }

    return '' +
      '<li class="tarjeta">' +
        '<button class="tarjeta__encabezado" type="button" ' +
          'data-accion="desplegar" aria-expanded="false" ' +
          'aria-controls="' + detalleId + '">' +
          '<span class="tarjeta__categoria">' + categoria + '</span>' +
          '<span class="tarjeta__titulo" role="heading" aria-level="3">' +
            titulo +
          '</span>' +
          '<span class="tarjeta__resumen">' + extracto + '</span>' +
          '<span class="tarjeta__pista">Ver fragmento' + CHEVRON + '</span>' +
        '</button>' +
        '<div class="tarjeta__detalle" id="' + detalleId + '" ' +
          'aria-hidden="true" inert>' +
          '<div class="tarjeta__detalle-inner">' +
            '<p class="tarjeta__fragmento">' + fragmento + '</p>' +
            (enlaces
              ? '<div class="tarjeta__enlaces">' + enlaces + '</div>'
              : '') +
          '</div>' +
        '</div>' +
      '</li>';
  }

  /** Cierra una tarjeta devolviéndola a su estado accesible inicial. */
  function cerrarTarjeta(tarjeta) {
    if (!tarjeta) return;

    tarjeta.classList.remove('tarjeta--abierta');

    const encabezado = tarjeta.querySelector('.tarjeta__encabezado');
    if (encabezado) encabezado.setAttribute('aria-expanded', 'false');

    const detalle = tarjeta.querySelector('.tarjeta__detalle');
    if (detalle) {
      detalle.setAttribute('aria-hidden', 'true');
      detalle.setAttribute('inert', '');
    }
  }

  /** Abre una tarjeta y deja sus enlaces accesibles con el teclado. */
  function abrirTarjeta(tarjeta) {
    tarjeta.classList.add('tarjeta--abierta');

    const encabezado = tarjeta.querySelector('.tarjeta__encabezado');
    if (encabezado) encabezado.setAttribute('aria-expanded', 'true');

    const detalle = tarjeta.querySelector('.tarjeta__detalle');
    if (detalle) {
      detalle.setAttribute('aria-hidden', 'false');
      detalle.removeAttribute('inert');
    }
  }

  /** Muestra los esqueletos de carga mientras llega la respuesta. */
  function mostrarCargando() {
    seccionResultados.hidden = false;
    seccionResultados.setAttribute('aria-busy', 'true');
    document.body.classList.add('buscando');

    if (botonLimpiar) botonLimpiar.hidden = false;
    if (botonVolver) botonVolver.hidden = false;

    lista.innerHTML = '';
    tarjetaAbierta = null;
    if (vacio) vacio.hidden = true;
    if (bloqueError) bloqueError.hidden = true;
    if (cargando) cargando.hidden = false;

    estado.textContent = 'Buscando en la base de datos…';
  }

  /** Oculta el estado de carga. */
  function ocultarCargando() {
    if (cargando) cargando.hidden = true;
    seccionResultados.setAttribute('aria-busy', 'false');
  }

  /** Pinta las tarjetas y actualiza el texto anunciado. */
  function renderizar(consulta, tokens, encontrados) {
    lista.innerHTML = encontrados
      .map(function (entrada, indice) {
        return crearHTMLResultado(entrada, tokens, consulta, indice);
      })
      .join('');
    tarjetaAbierta = null;

    seccionResultados.hidden = false;
    document.body.classList.add('buscando');

    if (botonLimpiar) botonLimpiar.hidden = false;
    if (botonVolver) botonVolver.hidden = false;

    if (vacio) vacio.hidden = encontrados.length > 0;
    if (bloqueError) bloqueError.hidden = true;

    if (consultaVacia) consultaVacia.textContent = '«' + consulta + '»';

    if (encontrados.length === 0) {
      estado.textContent = 'No encontramos resultados para «' + consulta + '».';
    } else {
      const total = encontrados.length;
      estado.textContent = total +
        (total === 1 ? ' resultado para «' : ' resultados para «') +
        consulta + '».';
    }
  }

  /** Muestra un mensaje claro si falló la conexión con la base de datos. */
  function mostrarError() {
    lista.innerHTML = '';
    tarjetaAbierta = null;
    if (vacio) vacio.hidden = true;
    if (bloqueError) bloqueError.hidden = false;

    estado.textContent = 'No se pudo completar la búsqueda.';
  }

  /** Oculta resultados, carga y error; vuelve a la portada limpia. */
  function ocultarResultados() {
    seccionResultados.hidden = true;
    seccionResultados.setAttribute('aria-busy', 'false');
    document.body.classList.remove('buscando');

    lista.innerHTML = '';
    tarjetaAbierta = null;
    estado.textContent = '';
    if (vacio) vacio.hidden = true;
    if (cargando) cargando.hidden = true;
    if (bloqueError) bloqueError.hidden = true;

    if (consultaVacia) consultaVacia.textContent = '';
    if (botonVolver) botonVolver.hidden = true;
  }

  /* ------------------------------------------------------------------------
     7. URL, DESPLAZAMIENTO Y CONTROL GENERAL
     ------------------------------------------------------------------------ */

  /** Sincroniza la consulta con ?q= para poder compartir el resultado. */
  function actualizarURL(consulta) {
    try {
      const url = new URL(window.location.href);

      if (consulta) url.searchParams.set('q', consulta);
      else url.searchParams.delete('q');

      window.history.replaceState(null, '', url);
    } catch (error) {
      /* Sin historial disponible (file://): la búsqueda sigue funcionando. */
    }
  }

  /** Lleva la vista a los resultados respetando movimiento reducido. */
  function desplazarAResultados() {
    const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    seccionResultados.scrollIntoView({
      behavior: sinMovimiento ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  /**
   * Punto central de la búsqueda. Ahora es asíncrono porque consulta la BD.
   */
  async function ejecutarBusqueda(consulta, opciones) {
    const config = Object.assign({
      desplazar: false,
      actualizarURL: true,
      enfocarResultados: false
    }, opciones || {});

    const texto = String(consulta || '').trim();

    if (botonLimpiar) botonLimpiar.hidden = texto.length === 0;

    /* Consulta vacía o demasiado corta: portada limpia. */
    if (!texto || texto.length < MIN_CARACTERES) {
      if (controlador) controlador.abort();
      idPeticion += 1;
      ultimaConsulta = '';
      ocultarResultados();
      if (config.actualizarURL) actualizarURL('');
      return;
    }

    ultimaConsulta = texto;
    mostrarCargando();
    if (config.actualizarURL) actualizarURL(texto);

    try {
      const resultado = await buscarEnServidor(texto);

      /* null = llegó una respuesta más antigua; otra búsqueda la reemplazó. */
      if (resultado === null) return;

      ocultarCargando();
      renderizar(texto, resultado.tokens, resultado.encontrados);

      if (config.desplazar) desplazarAResultados();
      if (config.enfocarResultados && tituloResultados) {
        tituloResultados.focus({ preventScroll: true });
      }
    } catch (error) {
      /* Un abort es esperado al escribir rápido: no se muestra como error. */
      if (error && error.name === 'AbortError') return;

      console.error('Error en el buscador:', error);
      ocultarCargando();
      mostrarError();
    }
  }

  /** Borra el texto, cancela la petición y devuelve el foco al buscador. */
  function limpiarTodo() {
    window.clearTimeout(temporizador);

    if (controlador) controlador.abort();
    idPeticion += 1;
    ultimaConsulta = '';

    campo.value = '';
    if (botonLimpiar) botonLimpiar.hidden = true;

    ocultarResultados();
    actualizarURL('');
    campo.focus();
  }

  /** Escritura con retardo para no consultar la BD en cada pulsación. */
  function manejarEntrada() {
    window.clearTimeout(temporizador);

    const texto = campo.value.trim();

    if (botonLimpiar) botonLimpiar.hidden = texto.length === 0;

    if (!texto || texto.length < MIN_CARACTERES) {
      if (controlador) controlador.abort();
      idPeticion += 1;
      ocultarResultados();
      actualizarURL('');
      return;
    }

    temporizador = window.setTimeout(function () {
      ejecutarBusqueda(campo.value, { actualizarURL: true });
    }, RETARDO);
  }

  /* ------------------------------------------------------------------------
     8. EVENTOS
     ------------------------------------------------------------------------ */

  campo.addEventListener('input', manejarEntrada);

  /* Acordeón: al abrir una tarjeta se cierra la que estuviera abierta. */
  lista.addEventListener('click', function (evento) {
    const encabezado = evento.target.closest('[data-accion="desplegar"]');
    if (!encabezado) return;

    const tarjeta = encabezado.closest('.tarjeta');
    if (!tarjeta) return;

    if (tarjetaAbierta === tarjeta) {
      cerrarTarjeta(tarjeta);
      tarjetaAbierta = null;
      return;
    }

    cerrarTarjeta(tarjetaAbierta);
    abrirTarjeta(tarjeta);
    tarjetaAbierta = tarjeta;
  });

  formulario.addEventListener('submit', function (evento) {
    evento.preventDefault();
    window.clearTimeout(temporizador);

    ejecutarBusqueda(campo.value, {
      desplazar: true,
      actualizarURL: true
    });
  });

  if (botonLimpiar) botonLimpiar.addEventListener('click', limpiarTodo);
  if (botonVolver) botonVolver.addEventListener('click', limpiarTodo);

  /* El botón del estado de error repite la última consulta. */
  if (botonReintentar) {
    botonReintentar.addEventListener('click', function () {
      if (ultimaConsulta) {
        ejecutarBusqueda(ultimaConsulta, { actualizarURL: false });
      }
    });
  }

  /* Escape limpia la búsqueda desde el campo. */
  campo.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      limpiarTodo();
    }
  });

  /* La tecla "/" enfoca el buscador, salvo que se esté escribiendo. */
  document.addEventListener('keydown', function (evento) {
    if (evento.key !== '/' || evento.ctrlKey || evento.metaKey || evento.altKey) {
      return;
    }

    const objetivo = evento.target;
    const estaEscribiendo = objetivo instanceof HTMLElement && (
      objetivo.matches('input, textarea, select') || objetivo.isContentEditable
    );

    if (estaEscribiendo) return;

    evento.preventDefault();
    campo.focus();
  });

  /* Las sugerencias del estado vacío lanzan una búsqueda inmediata. */
  if (vacio) {
    vacio.addEventListener('click', function (evento) {
      const boton = evento.target.closest('[data-sugerencia]');
      if (!boton) return;

      const consulta = boton.getAttribute('data-sugerencia') || '';

      campo.value = consulta;
      if (botonLimpiar) botonLimpiar.hidden = false;

      ejecutarBusqueda(consulta, {
        actualizarURL: true,
        enfocarResultados: true
      });
    });
  }

  /* ------------------------------------------------------------------------
     9. INICIO
     ------------------------------------------------------------------------ */

  /* Si la URL trae ?q=, se restaura la búsqueda al cargar la página. */
  const consultaInicial = new URLSearchParams(window.location.search).get('q');

  if (consultaInicial && consultaInicial.trim()) {
    campo.value = consultaInicial.trim();
    if (botonLimpiar) botonLimpiar.hidden = false;

    ejecutarBusqueda(consultaInicial, { actualizarURL: false });
  }
})();
