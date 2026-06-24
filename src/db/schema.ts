/** SQL schema. Applied once on startup; statements are idempotent. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    INTEGER NOT NULL
);

-- A bot is a per-(user, channel) credential set. Every colleague gets their
-- OWN bot for each platform we want to reach them on. accountId is the
-- handle the bridge / openclaw runtime uses to address it (e.g. "default",
-- "alice-qq", "bob-weixin").
CREATE TABLE IF NOT EXISTS bots (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  label           TEXT,
  credentials_json TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending',
  last_seen_at    INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE(channel, account_id)
);
CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);

-- An identity is a (channel, account_id, external_id) → user binding.
-- account_id matters because the same person's openid is different across
-- different QQ bots, and the same external_id can collide across accounts.
CREATE TABLE IF NOT EXISTS identities (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id       TEXT REFERENCES bots(id) ON DELETE SET NULL,
  channel      TEXT NOT NULL,
  account_id   TEXT NOT NULL DEFAULT 'default',
  external_id  TEXT NOT NULL,
  display_name TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE(channel, account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);
CREATE INDEX IF NOT EXISTS idx_identities_bot ON identities(bot_id);

CREATE TABLE IF NOT EXISTS topics (
  name       TEXT PRIMARY KEY,
  owner_id   TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  owner_id    TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic        TEXT NOT NULL,
  channels     TEXT NOT NULL DEFAULT '',
  min_priority INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  UNIQUE(user_id, topic)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_topic ON subscriptions(topic);

-- A whole group subscribed to a topic. Members (including ones added later)
-- all receive messages published to that topic. ntfy-style "add group to channel".
CREATE TABLE IF NOT EXISTS topic_groups (
  topic      TEXT NOT NULL,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  min_priority INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (topic, group_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_groups_topic ON topic_groups(topic);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  path         TEXT NOT NULL,
  owner_id     TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  topic         TEXT NOT NULL,
  title         TEXT,
  body          TEXT NOT NULL DEFAULT '',
  priority      INTEGER NOT NULL DEFAULT 3,
  tags          TEXT NOT NULL DEFAULT '',
  click         TEXT,
  sender        TEXT,
  attachment_id TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic, created_at);

CREATE TABLE IF NOT EXISTS webhooks (
  id         TEXT PRIMARY KEY,
  topic      TEXT NOT NULL,
  url        TEXT NOT NULL,
  secret     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_topic ON webhooks(topic);

CREATE TABLE IF NOT EXISTS tokens (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT UNIQUE NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT,
  scopes       TEXT NOT NULL DEFAULT 'publish,subscribe',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);

CREATE TABLE IF NOT EXISTS bindings (
  code        TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id      TEXT REFERENCES bots(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',
  channel     TEXT,
  account_id  TEXT,
  external_id TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id    TEXT,
  channel    TEXT NOT NULL,
  status     TEXT NOT NULL,
  error      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_message ON deliveries(message_id);
`;
