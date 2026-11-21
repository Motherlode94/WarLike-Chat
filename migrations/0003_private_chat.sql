CREATE TABLE IF NOT EXISTS chat_presence(user_id TEXT PRIMARY KEY, username TEXT NOT NULL, seen_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_direct(room_id TEXT PRIMARY KEY, member_a TEXT NOT NULL, member_b TEXT NOT NULL, UNIQUE(member_a,member_b));
