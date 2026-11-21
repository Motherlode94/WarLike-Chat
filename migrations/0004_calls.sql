CREATE TABLE IF NOT EXISTS chat_calls(id TEXT PRIMARY KEY, caller TEXT NOT NULL, callee TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, updated INTEGER NOT NULL, offer TEXT NOT NULL, answer TEXT);
CREATE INDEX IF NOT EXISTS chat_calls_callee ON chat_calls(callee,updated);
