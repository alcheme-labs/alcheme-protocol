-- User Totem: persistent stage tracking for living achievement badges
CREATE TABLE IF NOT EXISTS "user_totem" (
    "user_id"         INT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
    "stage"           VARCHAR(16) NOT NULL DEFAULT 'seed',
    "crystal_count"   INT NOT NULL DEFAULT 0,
    "citation_count"  INT NOT NULL DEFAULT 0,
    "circle_count"    INT NOT NULL DEFAULT 0,
    "last_active_at"  TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMP NOT NULL DEFAULT NOW()
);
