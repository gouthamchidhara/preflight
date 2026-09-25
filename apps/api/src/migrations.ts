/**
 * Append-only list of schema migrations (PLAN.md §5.4). Never edit a shipped entry — add a new one.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE devices (
    id uuid PRIMARY KEY,
    serial text NOT NULL UNIQUE,
    asset_tag text NOT NULL DEFAULT '',
    hostname text NOT NULL DEFAULT '',
    model text NOT NULL DEFAULT '',
    agent_version text NOT NULL DEFAULT '',
    os_build text NOT NULL DEFAULT '',
    telemetry jsonb NOT NULL DEFAULT '{}',
    run_request jsonb,
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE device_keys (
    key_hash text PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES devices(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
  );
  CREATE INDEX device_keys_device_idx ON device_keys(device_id);

  CREATE TABLE enrollment_tokens (
    id uuid PRIMARY KEY,
    label text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    max_uses int NOT NULL,
    uses int NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE policies (
    id text PRIMARY KEY,
    name text NOT NULL,
    version int NOT NULL,
    rules jsonb NOT NULL,
    edited_by text,
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE manual_items (
    id text PRIMARY KEY,
    stage text NOT NULL,
    label text NOT NULL,
    position int NOT NULL
  );

  CREATE TABLE runs (
    id uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES devices(id),
    trigger text NOT NULL,
    stage text,
    started_at timestamptz NOT NULL,
    finished_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    summary jsonb NOT NULL,
    results jsonb NOT NULL
  );
  CREATE INDEX runs_device_idx ON runs(device_id, finished_at DESC);

  CREATE TABLE latest_results (
    device_id uuid NOT NULL REFERENCES devices(id),
    rule_id text NOT NULL,
    result jsonb NOT NULL,
    checked_at timestamptz NOT NULL,
    PRIMARY KEY (device_id, rule_id)
  );

  CREATE TABLE attestations (
    id uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES devices(id),
    item_id text,
    rule_id text,
    by_user text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    note text,
    revoked_at timestamptz,
    CHECK ((item_id IS NULL) <> (rule_id IS NULL))
  );
  CREATE INDEX attestations_device_idx ON attestations(device_id) WHERE revoked_at IS NULL;

  CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES devices(id),
    script_id text NOT NULL,
    params jsonb NOT NULL,
    rule_id text,
    status text NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    dispatched_at timestamptz,
    finished_at timestamptz,
    exit_code int,
    stdout text,
    stderr text
  );
  CREATE INDEX jobs_device_status_idx ON jobs(device_id, status);

  CREATE TABLE audit_log (
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    actor text NOT NULL,
    action text NOT NULL,
    target text,
    detail jsonb NOT NULL DEFAULT '{}'
  );

  CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
  `,
];
