-- ==========================================================================
-- 0001_init.sql — Estructura inicial de la base de datos D1 del buscador.
-- --------------------------------------------------------------------------
-- D1 usa SQLite, por lo que aquí aplica la sintaxis de SQLite.
--
-- Aplicar en local:    npx wrangler d1 migrations apply derecho-alimentos-db --local
-- Aplicar en producción: npx wrangler d1 migrations apply derecho-alimentos-db --remote
--
-- Esta migración crea:
--   1. La tabla "articulos" con el contenido.
--   2. El índice FTS5 "articulos_fts" para búsquedas de texto completo.
--   3. Tres disparadores para mantener el índice sincronizado.
--   4. Datos de ejemplo (🔧 REEMPLAZA ESTOS INSERT POR TU CONTENIDO REAL).
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1. TABLA PRINCIPAL
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articulos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT, -- Identificador único.
  titulo      TEXT NOT NULL,                     -- Título de la tarjeta.
  categoria   TEXT NOT NULL,                     -- Etiqueta: Monto, Demandas, etc.
  resumen     TEXT NOT NULL,                     -- Texto corto que se ve en la tarjeta.
  contenido   TEXT NOT NULL DEFAULT '',          -- Texto completo (se puede desplegar).
  url         TEXT NOT NULL DEFAULT '#',         -- Enlace opcional; '#' = sin enlace.
  claves      TEXT NOT NULL DEFAULT '',           -- Palabras clave separadas por comas.
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índice normal para ordenar por fecha si se necesita en el futuro.
CREATE INDEX IF NOT EXISTS idx_articulos_categoria ON articulos(categoria);


-- --------------------------------------------------------------------------
-- 2. ÍNDICE FTS5 (TEXT COMPLETE SEARCH)
-- --------------------------------------------------------------------------
-- "content='articulos'" + "content_rowid='id'" hace que FTS5 NO duplique el
-- texto: solo guarda el índice y apunta a la tabla original por su id.
--
-- tokenize = 'unicode61 remove_diacritics 1':
--   * ignora mayúsculas;
--   * quita acentos, así que "pension" encuentra "pensión";
--   * separa palabras por signos de puntuación.
--
-- 👇 "contenido" se indexa también: así se puede buscar dentro del texto
-- completo, no solo en el título o el resumen.
CREATE VIRTUAL TABLE IF NOT EXISTS articulos_fts USING fts5(
  titulo,
  categoria,
  resumen,
  contenido,
  claves,
  content = 'articulos',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 1'
);


-- --------------------------------------------------------------------------
-- 3. DISPARADORES (mantienen el índice FTS5 al día)
-- --------------------------------------------------------------------------
-- Al INSERTAR: se agrega la fila al índice con el mismo rowid.
-- Los disparadores son los que permiten que el panel /admin funcione sin
-- tener que reconstruir el índice a mano después de cada cambio.
CREATE TRIGGER IF NOT EXISTS articulos_ai AFTER INSERT ON articulos BEGIN
  INSERT INTO articulos_fts(rowid, titulo, categoria, resumen, contenido, claves)
  VALUES (new.id, new.titulo, new.categoria, new.resumen, new.contenido, new.claves);
END;

-- Al BORRAR: se envía la fila vieja con la instrucción especial 'delete'.
CREATE TRIGGER IF NOT EXISTS articulos_ad AFTER DELETE ON articulos BEGIN
  INSERT INTO articulos_fts(articulos_fts, rowid, titulo, categoria, resumen, contenido, claves)
  VALUES ('delete', old.id, old.titulo, old.categoria, old.resumen, old.contenido, old.claves);
END;

-- Al ACTUALIZAR: se borra la versión vieja y se inserta la nueva.
CREATE TRIGGER IF NOT EXISTS articulos_au AFTER UPDATE ON articulos BEGIN
  INSERT INTO articulos_fts(articulos_fts, rowid, titulo, categoria, resumen, contenido, claves)
  VALUES ('delete', old.id, old.titulo, old.categoria, old.resumen, old.contenido, old.claves);
  INSERT INTO articulos_fts(rowid, titulo, categoria, resumen, contenido, claves)
  VALUES (new.id, new.titulo, new.categoria, new.resumen, new.contenido, new.claves);
END;

-- Reconstrucción de seguridad: si la tabla ya tenía datos antes de crear el
-- índice, esto lo sincroniza. Si está vacío no hace nada.
INSERT INTO articulos_fts(articulos_fts) VALUES ('rebuild');


-- ==========================================================================
-- 4. 🔧 DATOS DE EJEMPLO
-- --------------------------------------------------------------------------
-- Borra este bloque y escribe aquí tus propios INSERT cuando tengas el
-- contenido definitivo. El buscador mostrará tarjetas por cada fila.
-- El campo "contenido" admite varios párrafos separados por una línea en blanco.
-- ==========================================================================

INSERT INTO articulos (titulo, categoria, resumen, contenido, url, claves) VALUES
(
  'Monto de la pensión alimenticia',
  'Monto',
  'El monto se fija considerando las necesidades de quien recibe la pensión y la capacidad económica de quien la paga. No existe un porcentaje único obligatorio.',
  'La pensión alimenticia tiene como finalidad cubrir necesidades básicas como alimentación, vivienda, vestido, educación y salud.

Para determinar la cantidad idónea, los tribunales toman en cuenta el nivel de vida de la familia, los ingresos comprobables del deudor alimentario y las necesidades reales de los acreedores alimentarios.

En la práctica se utilizan como referencia el salario mínimo y el valor de la Unidad de Medida y Actualización (UMA), sin que exista una regla fija de porcentaje aplicable a todos los casos.',
  '#',
  'monto, pension, pension alimenticia, cantidad idonea, UMA, salario minimo, porcentaje, capacidad economica, necesidades'
),
(
  'Demanda de pensión alimenticia: requisitos',
  'Demandas',
  'La demanda debe presentarse por escrito ante el juez familiar competente e incluir el parentesco, las necesidades y las pruebas que acrediten la posibilidad económica del demandado.',
  'La demanda de alimentos es el acto jurídico con el que se inicia el procedimiento. Debe contener el nombre de las partes, el vínculo familiar que da origen a la obligación y la petición concreta.

Es recomendable acompañar documentos que acrediten ingresos, gastos y la relación de parentesco, además de ofrecer las pruebas pertinentes.

También puede solicitarse una medida provisional para asegurar una pensión mientras se resuelve el juicio.',
  '#',
  'demanda, demandas, pension, alimentos, requisitos, juez familiar, procedimiento, medida provisional, parentesco'
),
(
  'Formatos y modelos para juicios de alimentos',
  'Formatos',
  'Modelos de demanda, contestación y escritos de pruebas que sirven como punto de partida, siempre adaptados al caso concreto y a la legislación local aplicable.',
  'Un formato jurídico útil debe ser claro, ordenado y estar adaptado al código familiar o civil de la entidad correspondiente.

Los modelos ayudan a estructurar los hechos, la petición y el ofrecimiento de pruebas, pero no sustituyen el análisis jurídico del caso concreto.

Verifica siempre que el formato incluya lugar, fecha, firma y la firma electrónica cuando el sistema judicial lo requiera.',
  '#',
  'formatos, modelos, demanda, escrito, contestacion, pruebas, plantilla, litigio'
),
(
  'Ordenamientos que regulan el derecho de alimentos',
  'Legislación',
  'La materia se encuentra principalmente en los códigos civiles y familiares de cada entidad federativa, además de leyes federales relacionadas y tratados internacionales.',
  'Cada estado de la República cuenta con un código civil o un código familiar y procesal familiar que regula la obligación alimentaria.

Además existen leyes federales y disposiciones que protegen a niñas, niños y adolescentes, así como a personas adultas mayores o con discapacidad.

La jurisprudencia de los tribunales complementa la legislación al fijar criterios sobre el monto, la necesidad y la capacidad económica.',
  '#',
  'legislacion, codigo civil, codigo familiar, procesal familiar, leyes federales, ordenamientos, derecho de alimentos'
),
(
  'Tratados internacionales sobre obligaciones alimentarias',
  'Tratados',
  'Los tratados internacionales pueden servir de apoyo para interpretar la obligación alimentaria y para reconocer resoluciones dictadas en el extranjero.',
  'Diversos instrumentos internacionales reconocen el derecho a un nivel de vida adecuado y la protección de la infancia.

Cuando una persona reside en otro país, los convenios y tratados pueden facilitar el reconocimiento y ejecución de resoluciones judiciales.

Conviene revisar la legislación interna y los tratados ratificados por México antes de promover un procedimiento internacional.',
  '#',
  'tratados, internacional, convenios, reconocimiento, resoluciones, extranjero, infancia'
),
(
  'Jurisprudencia sobre el monto alimenticio',
  'Jurisprudencia',
  'Los criterios judiciales ayudan a interpretar conceptos como necesidad, posibilidad económica y proporcionalidad al fijar una pensión.',
  'La jurisprudencia reitera que el monto de la pensión debe ser proporcional a los ingresos del deudor y suficiente para cubrir las necesidades del acreedor.

También se ha establecido que la obligación alimentaria es preferente frente a otras deudas.

Al citar un criterio judicial, verifica la materia, la época y el órgano que lo emitió.',
  '#',
  'jurisprudencia, criterios, tesis, monto, proporcionalidad, necesidad, tribunales, ejecutoria'
),
(
  'Pruebas para acreditar necesidades e ingresos',
  'Pruebas',
  'Recibos de nómina, declaraciones fiscales, estados de cuenta y comprobantes de gastos son pruebas comunes en los juicios de alimentos.',
  'La carga de la prueba implica presentar elementos que acrediten tanto las necesidades como la capacidad económica.

Entre las pruebas útiles se encuentran recibos de pago, contratos de trabajo, estados de cuenta, comprobantes de colegiaturas y gastos médicos.

También pueden ofrecerse testimonios y documentos que muestren el nivel de vida de la familia.',
  '#',
  'pruebas, evidencia, recibos, nomina, estados de cuenta, comprobantes, gastos, carga de la prueba'
),
(
  'Medidas provisionales en el procedimiento familiar',
  'Procedimiento',
  'La medida provisional permite fijar una pensión temporal mientras se tramita el juicio, para evitar que la familia quede sin recursos.',
  'Las medidas provisionales son decisiones anticipadas que dicta el juez para proteger los derechos de las partes mientras se resuelve el fondo del asunto.

Pueden comprender el pago de una pensión, la conservación de bienes o la prohibición de enajenar activos.

Su solicitud debe acompañarse de elementos que hagan ver la urgencia de la medida.',
  '#',
  'procedimiento, medidas provisionales, temporal, juez, urgencia, tramite, juicio'
),
(
  'UMA y salario mínimo: diferencias para el cálculo',
  'Monto',
  'El salario mínimo y la UMA son referencias distintas. La UMA se usa para determinar obligaciones y el salario mínimo para cuestiones laborales.',
  'La Unidad de Medida y Actualización es una referencia económica utilizada para actualizar cantidades y determinar obligaciones.

El salario mínimo, por su parte, es la remuneración mínima que debe recibir una persona trabajadora por una jornada de trabajo.

Elegir una u otra referencia puede cambiar de forma importante el resultado del cálculo de una pensión.',
  '#',
  'UMA, salario minimo, calculo, diferencia, referencia, actualizacion, monto'
),
(
  'Deudor alimentario moroso y consecuencias',
  'Práctica',
  'El incumplimiento de la obligación alimentaria puede generar responsabilidades civiles y, en ciertos casos, consecuencias de carácter penal.',
  'El deudor alimentario moroso es quien, pudiendo hacerlo, no cumple con el pago de la pensión fijada judicialmente.

El incumplimiento puede dar lugar a requerimientos, a la ejecución de la resolución y a medidas de apremio.

En los supuestos previstos por la ley, también puede configurarse el delito de incumplimiento de obligaciones alimentarias.',
  '#',
  'deudor, moroso, incumplimiento, consecuencias, ejecucion, apremio, delito, responsabilidad'
);
