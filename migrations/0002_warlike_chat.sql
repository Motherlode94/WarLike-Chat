CREATE TABLE IF NOT EXISTS chat_rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES chat_rooms(id), user_id TEXT NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER, deleted_by TEXT);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id,created_at);
INSERT OR IGNORE INTO chat_rooms(id,name,description) VALUES ('general','général','Discussions de la communauté'),('gaming','gaming','Jeux et tests'),('studio','studio','Musique et créations'),('annonces','annonces','Actualités WarLike');
