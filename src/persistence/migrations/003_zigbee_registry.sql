-- Domyro schema v3: explicitly site-owned Zigbee2MQTT bindings.
-- Read-only discovery is never automatically associated with a home.
CREATE TABLE domyro_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES domyro_sites(id) ON DELETE RESTRICT,
  protocol TEXT NOT NULL CHECK (protocol IN ('zigbee2mqtt')),
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  base_topic TEXT NOT NULL CHECK (char_length(base_topic) BETWEEN 1 AND 128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, site_id),
  UNIQUE (site_id, protocol, base_topic)
);
CREATE INDEX domyro_integrations_by_site ON domyro_integrations(site_id);

CREATE TABLE domyro_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL,
  site_id UUID NOT NULL,
  external_id TEXT NOT NULL CHECK (external_id ~ '^0x[0-9a-f]{16}$'),
  friendly_name TEXT NOT NULL CHECK (char_length(friendly_name) BETWEEN 1 AND 128),
  model TEXT,
  vendor TEXT,
  supported BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_id, site_id) REFERENCES domyro_integrations(id, site_id) ON DELETE RESTRICT,
  UNIQUE (integration_id, external_id)
);
CREATE INDEX domyro_devices_by_site ON domyro_devices(site_id, integration_id, external_id);

CREATE TABLE domyro_observations (
  device_id UUID NOT NULL REFERENCES domyro_devices(id) ON DELETE RESTRICT,
  field TEXT NOT NULL CHECK (field IN ('state','temperature','humidity','battery','occupancy','contact','water_leak','brightness','linkquality')),
  value_json JSONB NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('confirmed','stale','unknown','unavailable')),
  observed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, field)
);
-- JSON observation content is bounded and type-checked in the repository,
-- which must only be accessed by an internally authenticated service.
