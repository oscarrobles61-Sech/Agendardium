-- PIN de acceso por usuario, límite de intentos de ingreso y revisión por documento (para no pisar turnos).

-- PIN de cada integrante, guardado como hash scrypt (nunca el PIN en sí).
-- Sin clave foránea a users: la app reescribe la fila del usuario al guardar su perfil y eso borraría el PIN.
-- "ver" cambia cada vez que se crea o restablece el PIN: las sesiones abiertas con un PIN anterior dejan de valer.
-- "temp" = PIN temporal generado por la secretaría: al ingresar con él hay que elegir uno propio.
CREATE TABLE IF NOT EXISTS "user_pins" (
  "user_id"  TEXT PRIMARY KEY,
  "pin_hash" TEXT NOT NULL,
  "temp"     BOOLEAN NOT NULL DEFAULT false,
  "ver"      BIGINT NOT NULL,
  "set_by"   TEXT,
  "set_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Intentos fallidos de ingreso, por DNI ("dni:...") y por IP ("ip:..."). Se bloquea temporalmente al pasar el límite.
CREATE TABLE IF NOT EXISTS "login_attempts" (
  "key"          TEXT PRIMARY KEY,
  "fails"        INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(3),
  "updated_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Revisión de cada documento. Al guardar se puede exigir la revisión que se leyó: si otra persona guardó
-- en el medio, la escritura entera se rechaza en vez de pisar lo que la otra persona cargó.
CREATE TABLE IF NOT EXISTS "doc_revs" (
  "col" TEXT NOT NULL,
  "id"  TEXT NOT NULL,
  "rev" BIGINT NOT NULL,
  PRIMARY KEY ("col", "id")
);

-- Sube la revisión del documento. Con p_expected, solo si la revisión actual es esa (0 = documento sin revisión);
-- si no, corta la transacción con el código AGC01 (la app responde 409).
CREATE OR REPLACE FUNCTION bump_doc_rev(p_col TEXT, p_id TEXT, p_expected BIGINT) RETURNS BIGINT AS $$
DECLARE r BIGINT;
BEGIN
  INSERT INTO doc_revs (col, id, rev) VALUES (p_col, p_id, 1)
  ON CONFLICT (col, id) DO UPDATE SET rev = doc_revs.rev + 1
    WHERE p_expected IS NULL OR doc_revs.rev = p_expected
  RETURNING rev INTO r;
  IF r IS NULL OR (p_expected IS NOT NULL AND r <> p_expected + 1) THEN
    RAISE EXCEPTION 'otra persona modificó este documento' USING ERRCODE = 'AGC01';
  END IF;
  RETURN r;
END;
$$ LANGUAGE plpgsql;
