/* ==========================================================================
   ingresar.js — Formulario de acceso al panel (/ingresar.html).
   Envía la contraseña a /api/admin/sesion; el servidor devuelve la cookie
   HttpOnly firmada. Nunca guardamos contraseñas ni tokens en localStorage.
   ========================================================================== */

'use strict';

(function () {
  const formulario = document.getElementById('form-ingresar');
  const campo = document.getElementById('campo-clave');
  const boton = document.getElementById('login-enviar');
  const estado = document.getElementById('login-estado');
  const destino = document.getElementById('login-next');

  if (!formulario || !campo || !estado) return;

  /** El parámetro next Solo puede apuntar al propio panel (evita redirecciones abiertas). */
  function destinoSeguro(valor) {
    const texto = String(valor || '');
    return texto.startsWith('/admin/') && !texto.startsWith('//')
      ? texto
      : '/admin/';
  }

  function mostrarEstado(mensaje, tipo) {
    estado.textContent = mensaje;
    estado.className = 'admin-estado' + (tipo ? ' admin-estado--' + tipo : '');
  }

  const parametros = new URLSearchParams(window.location.search);
  if (destino) destino.value = destinoSeguro(parametros.get('next'));

  formulario.addEventListener('submit', async function (evento) {
    evento.preventDefault();

    const contrasena = campo.value.trim();
    if (!contrasena) {
      mostrarEstado('Escribe la contraseña.', 'error');
      campo.focus();
      return;
    }

    if (boton) boton.disabled = true;
    mostrarEstado('Comprobando…');

    try {
      const respuesta = await fetch('/api/admin/sesion', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: contrasena }),
        cache: 'no-store'
      });

      const datos = await respuesta.json().catch(function () { return {}; });

      if (!respuesta.ok || !datos.ok) {
        throw new Error(
          datos.error || 'No se pudo iniciar sesión. Inténtalo de nuevo.'
        );
      }

      mostrarEstado('Acceso correcto. Redirigiendo…', 'ok');
      window.location.assign(destino ? destino.value : '/admin/');
    } catch (error) {
      mostrarEstado(error.message, 'error');
      campo.select();
      if (boton) boton.disabled = false;
    }
  });
})();
