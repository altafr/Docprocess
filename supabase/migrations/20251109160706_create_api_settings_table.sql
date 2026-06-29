/*
  # Create API Settings Table

  1. New Tables
    - `api_settings`
      - `id` (uuid, primary key) - Unique identifier for each setting
      - `key` (text, unique) - Setting key name (e.g., 'OPENROUTER_API_KEY')
      - `value` (text) - Encrypted setting value
      - `description` (text) - Human-readable description of the setting
      - `created_at` (timestamptz) - Timestamp when setting was created
      - `updated_at` (timestamptz) - Timestamp when setting was last updated
  
  2. Security
    - Enable RLS on `api_settings` table
    - Add policy for service role to manage settings
    - Settings are only accessible server-side, not from client
  
  3. Important Notes
    - This table stores API keys and sensitive configuration
    - Only server-side code with service role can access these settings
    - Client applications cannot read these values due to RLS policies
*/

CREATE TABLE IF NOT EXISTS api_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  description text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE api_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage api_settings"
  ON api_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_api_settings_key ON api_settings(key);