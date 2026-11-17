/* ==========================================================================
   admin/admin.js — Lógica del panel de administración.
   --------------------------------------------------------------------------
   Solo habla con /api/admin/entradas, que es la Pages Function protegida
   por Cloudflare Access en producción.

   Funciones:
     - Listar entradas.
     - Crear una entrada con Título + Contenido.
     - Editar una entrada existente.
     - Borrar una entrada (con confirmación).

   Los datos se escriben con textContent / createElement para no insertar
   HTML del usuario en el panel.
   ========================================================================== */

'use strict';

(function () {
  /* ------------------------------------------------------------------------
     1. REFERENCIAS DEL DOM
     ------------------------------------------------------------------------ */

  const API = '/api/admin/entradas';

  const formulario = document.getElementById('form-entrada');
  const campo = document.getElementById('campo-titulo');
  const area = document.getElementById('campo-contenido');
  const botonGuardar = document.getElementById('admin-guardar');
  const botonCancelar = document.getElementById('admin-cancelar');
  const botonRecargar = document.getElementById('admin-recargar');
  const estado = document.getElementById('admin-estado');
  const lista = document.getElementById('admin-lista');
  const tituloFormulario = document.getElementById('form-titulo');

  if (!formulario || !campo || !area || !lista) return;

  /* null = creando; número = editando esa entrada. */
  let idEditando = null;

  /* ------------------------------------------------------------------------
     2. AUXILIARES
     ------------------------------------------------------------------------ */

  /** Muestra un mensaje en la zona de estado del formulario. */
  function mostrarEstado(mensaje, tipo) {
    estado.textContent = mensaje;
    estado.className = 'admin-estado' + (tipo ? ' admin-estado--' + tipo : '');
  }

  /** Devuelve una fecha legible, o una cadena vacía si no viene en la BD. */
  function formatearFecha(valor) {
    if (!valor) return '';

    try {
      return new Date(valor).toLocaleDateString('es-MX', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (error) {
      return '';
    }
  }

  /**
   * Llama a la API y devuelve el JSON. Lanza un Error con el mensaje
   * del servidor cuando algo falla.
   */
  async function pedir(opciones) {
    let respuesta;

    try {
      respuesta = await fetch(API + (opciones.query || ''), {
        method: opciones.metodo || 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: opciones.cuerpo || undefined,
        cache: 'no-store'
      });
    } catch (error) {
      throw new Error('No se pudo conectar con el servidor.');
    }

    let datos;

    try {
      datos = await respuesta.json();
    } catch (error) {
      throw new Error('El servidor devolvió una respuesta inesperada.');
    }

    if (!respuesta.ok || datos.error) {
      throw new Error(datos.error || 'Error HTTP ' + respuesta.status);
    }

    return datos;
  }

  /* ------------------------------------------------------------------------
     3. LISTADO
     ------------------------------------------------------------------------ */

  /** Crea una fila de la lista usando nodos DOM (nunca innerHTML). */
  function crearFila(entrada) {
    const fila = document.createElement('article');
    fila.className = 'admin-fila';

    const info = document.createElement('div');
    info.className = 'admin-fila__info';

    const titulo = document.createElement('h4');
    titulo.className = 'admin-fila__titulo';
    titulo.textContent = entrada.titulo;

    const meta = document.createElement('p');
    meta.className = 'admin-fila__meta';
    const fecha = formatearFecha(entrada.created_at);
    meta.textContent = (entrada.categoria || 'Artículo') + (fecha ? ' · ' + fecha : '');

    info.append(titulo, meta);

    const acciones = document.createElement('div');
    acciones.className = 'admin-fila__acciones';

    const editar = document.createElement('button');
    editar.type = 'button';
    editar.className = 'admin-boton admin-boton--texto';
    editar.textContent = 'Editar';
    editar.dataset.accion = 'editar';
    editar.dataset.id = String(entrada.id);

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'admin-boton admin-boton--texto admin-boton--peligro';
    borrar.textContent = 'Eliminar';
    borrar.dataset.accion = 'eliminar';
    borrar.dataset.id = String(entrada.id);

    acciones.append(editar, borrar);
    fila.append(info, acciones);

    return fila;
  }

  /** Carga y pinta todas las entradas. */
  async function cargarLista() {
    try {
      const datos = await pedir({ metodo: 'GET' });

      lista.replaceChildren();

      if (!datos.entradas || datos.entradas.length === 0) {
        const vacio = document.createElement('p');
        vacio.className = 'admin-vacio';
        vacio.textContent = 'Todavía no hay entradas guardadas.';
        lista.append(vacio);
        return;
      }

      datos.entradas.forEach(function (entrada) {
        lista.append(crearFila(entrada));
      });
    } catch (error) {
      lista.replaceChildren();
      const aviso = document.createElement('p');
      aviso.className = 'admin-vacio admin-vacio--error';
      aviso.textContent = error.message;
      lista.append(aviso);
    }
  }

  /* ------------------------------------------------------------------------
     4. CREAR / EDITAR / BORRAR
     ------------------------------------------------------------------------ */

  /** Deja el formulario listo para crear una entrada nueva. */
  function reiniciarFormulario() {
    idEditando = null;
    formulario.reset();
    if (botonCancelar) botonCancelar.hidden = true;
    if (botonGuardar) botonGuardar.textContent = 'Guardar entrada';
    if (tituloFormulario) tituloFormulario.textContent = 'Nueva entrada';
  }

  /** Guarda o actualiza, según estemos creando o editando. */
  formulario.addEventListener('submit', async function (evento) {
    evento.preventDefault();

    const titulo = campo.value.trim();
    const contenido = area.value.trim();

    if (botonGuardar) botonGuardar.disabled = true;
    mostrarEstado('Guardando…');

    try {
      const cuerpo = idEditando
        ? JSON.stringify({ id: idEditando, titulo: titulo, contenido: contenido })
        : JSON.stringify({ titulo: titulo, contenido: contenido });

      await pedir({
        metodo: idEditando ? 'PATCH' : 'POST',
        cuerpo: cuerpo
      });

      mostrarEstado(idEditando ? 'Entrada actualizada.' : 'Entrada guardada.', 'ok');
      reiniciarFormulario();
      await cargarLista();
    } catch (error) {
      mostrarEstado(error.message, 'error');
    } finally {
      if (botonGuardar) botonGuardar.disabled = false;
    }
  });

  /** Cancela la edición y vuelve al modo "nueva entrada". */
  if (botonCancelar) {
    botonCancelar.addEventListener('click', function () {
      reiniciarFormulario();
      mostrarEstado('');
      campo.focus();
    });
  }

  /** Editar rellena el formulario; Eliminar pide confirmación. */
  lista.addEventListener('click', async function (evento) {
    const boton = evento.target.closest('[data-accion]');
    if (!boton) return;

    const id = Number(boton.dataset.id);
    const accion = boton.dataset.accion;

    if (accion === 'editar') {
      /* El listado no trae el contenido completo: se pide con ?id=. */
      try {
        const detalle = await pedir({ metodo: 'GET', query: '?id=' + id });

        if (!detalle.entrada) throw new Error('No se encontró la entrada.');

        campo.value = detalle.entrada.titulo;
        area.value = detalle.entrada.contenido;

        idEditando = id;
        if (botonGuardar) botonGuardar.textContent = 'Guardar cambios';
        if (botonCancelar) botonCancelar.hidden = false;
        if (tituloFormulario) tituloFormulario.textContent = 'Editar entrada';

        mostrarEstado('Editando la entrada seleccionada.');
        campo.focus();
        campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (error) {
        mostrarEstado(error.message, 'error');
      }

      return;
    }

    if (accion === 'eliminar') {
      if (!window.confirm('¿Eliminar esta entrada? Esta acción no se puede deshacer.')) {
        return;
      }

      try {
        await pedir({ metodo: 'DELETE', query: '?id=' + id });
        mostrarEstado('Entrada eliminada.', 'ok');
        if (idEditando === id) reiniciarFormulario();
        await cargarLista();
      } catch (error) {
        mostrarEstado(error.message, 'error');
      }
    }
  });

  /** Botón manual de actualización del listado. */
  if (botonRecargar) {
    botonRecargar.addEventListener('click', function () {
      cargarLista();
    });
  }

  /* ------------------------------------------------------------------------
     5. INICIO
     ------------------------------------------------------------------------ */

  cargarLista();
})();
