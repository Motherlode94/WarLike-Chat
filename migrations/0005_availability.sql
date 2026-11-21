CREATE TABLE IF NOT EXISTS chat_availability(user_id TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('available','busy','away','meeting','dnd')));
