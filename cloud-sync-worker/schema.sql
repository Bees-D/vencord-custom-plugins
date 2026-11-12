CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT NOT NULL,
    plugin TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, plugin)
);

CREATE TABLE IF NOT EXISTS images (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
);
