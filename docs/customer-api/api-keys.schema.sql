-- Arbitrade Customer API v1 — API key & scope data model
-- Target: MySQL 8 (matches the platform's drizzle/MySQL schema).
-- Money is never stored here; these tables only govern access, delivery, and audit.

-- ---------------------------------------------------------------------------
-- API keys: one row per issued key. The secret is never stored; only a hash.
-- Scopes are validated server-side against the fixed allowlist in API-DESIGN.md.
-- ---------------------------------------------------------------------------
CREATE TABLE api_keys (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id               BIGINT UNSIGNED NOT NULL,             -- owning customer
  name                  VARCHAR(64)  NOT NULL,                -- human label
  key_prefix            VARCHAR(40)  NOT NULL,                -- e.g. ak_live_9f3c1a7b2d4e6f80 (public, indexed)
  secret_hash           CHAR(64)     NOT NULL,                -- sha256(secret) hex
  scopes                JSON         NOT NULL,                -- ["wallets:read","ledger:read"]
  environment           ENUM('live','test') NOT NULL DEFAULT 'live',
  ip_allowlist          JSON         NULL,                    -- ["203.0.113.4/32"] or NULL for any
  rate_limit_per_minute INT UNSIGNED NULL,                    -- NULL -> platform default (120)
  status                ENUM('active','revoked') NOT NULL DEFAULT 'active',
  last_used_at          TIMESTAMP    NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at            TIMESTAMP    NULL,
  revoked_reason        VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_prefix (key_prefix),
  KEY idx_api_keys_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Webhook endpoints a customer registers to receive signed events.
-- ---------------------------------------------------------------------------
CREATE TABLE api_webhook_endpoints (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  url               VARCHAR(512) NOT NULL,                    -- https:// only
  secret_encrypted  VARBINARY(255) NOT NULL,                  -- signing secret, encrypted at rest
  subscribed_events JSON         NOT NULL,                    -- ["trade.settled","payout.updated"]
  description       VARCHAR(128) NULL,
  status            ENUM('active','paused','disabled') NOT NULL DEFAULT 'active',
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_webhook_endpoints_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- One row per delivery attempt group; retries update the same row.
-- ---------------------------------------------------------------------------
CREATE TABLE api_webhook_deliveries (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  endpoint_id     BIGINT UNSIGNED NOT NULL,
  event_id        CHAR(36)     NOT NULL,                      -- idempotent event id (uuid)
  event_type      VARCHAR(64)  NOT NULL,                      -- "trade.settled"
  payload         JSON         NOT NULL,
  status          ENUM('pending','delivered','failed','dead') NOT NULL DEFAULT 'pending',
  attempts        INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP    NULL,
  response_status INT UNSIGNED NULL,
  next_attempt_at TIMESTAMP    NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_event (endpoint_id, event_id),       -- at-least-once, deduped per endpoint
  KEY idx_delivery_retry (status, next_attempt_at),
  CONSTRAINT fk_delivery_endpoint FOREIGN KEY (endpoint_id) REFERENCES api_webhook_endpoints(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Idempotency for write endpoints (phase 2). Same key + same body replays the
-- stored response; same key + different body is rejected with 409.
-- Mirrors the platform's existing wallet-adjustment idempotency pattern.
-- ---------------------------------------------------------------------------
CREATE TABLE api_idempotency_keys (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  api_key_id   BIGINT UNSIGNED NOT NULL,
  idem_key     VARCHAR(160) NOT NULL,                         -- Idempotency-Key header
  request_hash CHAR(64)     NOT NULL,                         -- sha256(method|path|body)
  response     JSON         NULL,                             -- stored response to replay
  status       ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   TIMESTAMP    NOT NULL,                         -- e.g. created_at + 24h
  PRIMARY KEY (id),
  UNIQUE KEY uq_idem (api_key_id, idem_key),
  KEY idx_idem_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Request audit log. Every API call records the key, route, outcome.
-- ---------------------------------------------------------------------------
CREATE TABLE api_request_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  api_key_id   BIGINT UNSIGNED NULL,                          -- NULL if auth failed before resolution
  request_id   CHAR(36)     NOT NULL,                         -- X-Request-Id returned to caller
  method       VARCHAR(8)   NOT NULL,
  path         VARCHAR(255) NOT NULL,
  status       INT UNSIGNED NOT NULL,
  latency_ms   INT UNSIGNED NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_req_log_key (api_key_id, created_at),
  KEY idx_req_log_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
