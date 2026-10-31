-- Explicit second migration. First migration remains immutable/checksummed.
-- One installation per database. Does not create users or expose a setup token.
INSERT INTO domyro_installations(singleton)
VALUES(TRUE)
ON CONFLICT (singleton) DO NOTHING;
