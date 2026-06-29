/*
  # Add OCR Provider Settings

  1. Changes
    - Add ocr_provider column to api_settings for storing the selected OCR provider
    - Insert default OCR provider setting (replicate)
    - Add OpenRouter API key placeholder
  
  2. Security
    - Uses existing RLS policies on api_settings table
    - No new security changes needed
*/

-- Add OCR provider setting if it doesn't exist
INSERT INTO api_settings (key, value)
VALUES ('ocr_provider', 'replicate')
ON CONFLICT (key) DO NOTHING;

-- Add OpenRouter API key placeholder if it doesn't exist
INSERT INTO api_settings (key, value)
VALUES ('OPENROUTER_API_KEY', '')
ON CONFLICT (key) DO NOTHING;