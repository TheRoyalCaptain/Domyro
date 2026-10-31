-- Domyro schema v1. Runs only via the explicit migration command.
-- D-53: never trigger schema migrations through background update checks.
CREATE TABLE domyro_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT TRUE UNIQUE CHECK (singleton),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE domyro_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT domyro_login_format CHECK (login ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  CONSTRAINT domyro_password_hash_format CHECK (length(password_hash) BETWEEN 30 AND 1024)
);

CREATE TABLE domyro_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL REFERENCES domyro_installations(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  time_zone TEXT NOT NULL DEFAULT 'Europe/Amsterdam' CHECK (char_length(time_zone) BETWEEN 1 AND 100),
  locale TEXT NOT NULL DEFAULT 'nl' CHECK (locale IN ('nl', 'en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE domyro_site_memberships (
  site_id UUID NOT NULL REFERENCES domyro_sites(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES domyro_users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'resident', 'guest')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, user_id)
);
CREATE INDEX domyro_memberships_by_user ON domyro_site_memberships(user_id, site_id);

CREATE TABLE domyro_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES domyro_sites(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX domyro_areas_by_site ON domyro_areas(site_id, sort_order, created_at);

CREATE TABLE domyro_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES domyro_users(id) ON DELETE RESTRICT,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT domyro_session_expiry CHECK (expires_at > created_at)
);
CREATE INDEX domyro_sessions_by_user ON domyro_sessions(user_id, expires_at DESC);

-- No login, cookie, or password setter is made public by this migration alone.
-- A later migration will add device/entity, outbox, and history contracts.
