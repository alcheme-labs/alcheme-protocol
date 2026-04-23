-- Add crystal_params JSONB column to knowledge table
ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS crystal_params JSONB;
