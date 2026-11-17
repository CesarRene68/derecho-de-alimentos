-- ==========================================================================
-- 0003_quitar_categoria.sql — Elimina la columna "categoria" del buscador.
-- --------------------------------------------------------------------------
-- El sitio ya no organiza el contenido por categorías: todo se encuentra
-- con el buscador. Esta migración conserva los artículos existentes.
--
-- Se ha escrito para que funcione tanto sobre una base creada con la versión
-- anterior de 0001_init.sql (con "categoria") como sobre una base creada con
-- la versión actual (sin ella). Por eso no usa ALTER TABLE DROP COLUMN.
--
-- Aplicar en local:     npx wrangler d1 migrations apply DB --local
-- Aplicar en producción: npx wrangler d1 migrations apply DB --remote
-- ==========================================================================


-- 1. Se retiran los disparadores y el índice FTS antes de tocar las tablas.
DROP TRIGGER IF EXISTS articulos_ai;
DROP TRIGGER IF EXISTS articulos_ad;
DROP TRIGGER IF EXISTS articulos_au;
DROP INDEX IF EXISTS idx_articulos_categoria;
DROP TABLE IF EXISTS articulos_fts;


-- 2. Tabla de destino, sin la columna "categoria".
CREATE TABLE IF NOT EXISTS articulos_nuevo (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo      TEXT NOT NULL,
  resumen     TEXT NOT NULL,
  contenido   TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '#',
  claves      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Se copia todo el contenido existente. La lista de columnas es explícita:
--    si la tabla antigua tenía "categoria", simplemente no se copia.
INSERT INTO articulos_nuevo (id, titulo, resumen, contenido, url, claves, created_at)
SELECT id, titulo, resumen, contenido, url, claves, created_at
FROM articulos;

DROP TABLE articulos;
ALTER TABLE articulos_nuevo RENAME TO articulos;


-- 4. Índice FTS5 reconstruido solo con los campos que se buscan.
CREATE VIRTUAL TABLE articulos_fts USING fts5(
  titulo,
  resumen,
  contenido,
  claves,
  content = 'articulos',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 1'
);

CREATE TRIGGER articulos_ai AFTER INSERT ON articulos BEGIN
  INSERT INTO articulos_fts(rowid, titulo, resumen, contenido, claves)
  VALUES (new.id, new.titulo, new.resumen, new.contenido, new.claves);
END;

CREATE TRIGGER articulos_ad AFTER DELETE ON articulos BEGIN
  INSERT INTO articulos_fts(articulos_fts, rowid, titulo, resumen, contenido, claves)
  VALUES ('delete', old.id, old.titulo, old.resumen, old.contenido, old.claves);
END;

CREATE TRIGGER articulos_au AFTER UPDATE ON articulos BEGIN
  INSERT INTO articulos_fts(articulos_fts, rowid, titulo, resumen, contenido, claves)
  VALUES ('delete', old.id, old.titulo, old.resumen, old.contenido, old.claves);
  INSERT INTO articulos_fts(rowid, titulo, resumen, contenido, claves)
  VALUES (new.id, new.titulo, new.resumen, new.contenido, new.claves);
END;

INSERT INTO articulos_fts(articulos_fts) VALUES ('rebuild');
