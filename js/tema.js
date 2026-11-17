/* ==========================================================================
   tema.js — Control del tema claro/oscuro.
   --------------------------------------------------------------------------
   El tema claro es el predeterminado. La preferencia se guarda en
   localStorage y se aplica antes del primer pintado desde un pequeño script
   incluido en el <head> de index.html, para evitar el destello blanco.
   ========================================================================== */

'use strict';

(function () {
  const html = document.documentElement;
  const boton = document.getElementById('boton-tema');
  const metaTema = document.querySelector('meta[name="theme-color"]');

  /* Si la página no tiene el botón, no se ejecuta nada. */
  if (!boton) return;

  const CLAVE_ALMACEN = 'tema';
  const COLORES = {
    light: '#ffffff',
    dark: '#202124'
  };

  /**
   * Devuelve el tema activo según el atributo data-theme del <html>.
   * Cualquier valor distinto de "dark" se considera claro.
   */
  function temaActual() {
    return html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  /**
   * Actualiza el nombre accesible del botón y el color de la barra del
   * navegador. Los iconos se alternan solo con CSS.
   */
  function actualizarInterfaz(tema) {
    const esOscuro = tema === 'dark';

    boton.setAttribute(
      'aria-label',
      esOscuro ? 'Activar tema claro' : 'Activar tema oscuro'
    );
    boton.setAttribute(
      'title',
      esOscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'
    );

    if (metaTema) {
      metaTema.setAttribute('content', COLORES[tema]);
    }
  }

  /**
   * Guarda la preferencia. Se protege con try/catch porque algunos
   * navegadores bloquean localStorage en modo privado o al abrir file://.
   */
  function guardarPreferencia(tema) {
    try {
      localStorage.setItem(CLAVE_ALMACEN, tema);
    } catch (error) {
      /* Sin almacenamiento: el tema sigue funcionando en esta sesión. */
    }
  }

  /**
   * Aplica el tema y, opcionalmente, lo persiste.
   */
  function aplicarTema(tema, persistir) {
    html.setAttribute('data-theme', tema);
    actualizarInterfaz(tema);

    if (persistir) {
      guardarPreferencia(tema);
    }
  }

  /* Cada clic alterna entre claro y oscuro. */
  boton.addEventListener('click', function () {
    const siguiente = temaActual() === 'dark' ? 'light' : 'dark';
    aplicarTema(siguiente, true);
  });

  /* Sincroniza el estado inicial del botón con el tema ya aplicado. */
  actualizarInterfaz(temaActual());
})();
