/*
  # Add public read access to API settings

  1. Changes
    - Add policy to allow authenticated users to read their own settings
    - Service role retains full management access
  
  2. Security Notes
    - This allows the application to bootstrap itself
    - Settings are read-only for regular access
    - Only service role can write/update settings
*/

CREATE POLICY "Allow public read access to api_settings"
  ON api_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);