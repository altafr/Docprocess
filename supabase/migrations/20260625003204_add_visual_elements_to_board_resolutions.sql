-- Add visual_elements column to store extracted signatures and stamps
ALTER TABLE board_resolutions
  ADD COLUMN IF NOT EXISTS visual_elements JSONB DEFAULT NULL;

-- Allow insert by authenticated and service role (edge function persists resolutions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'board_resolutions'
      AND policyname = 'authenticated_insert_board_resolutions'
  ) THEN
    CREATE POLICY "authenticated_insert_board_resolutions"
      ON board_resolutions FOR INSERT TO authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'board_resolutions'
      AND policyname = 'service_insert_board_resolutions'
  ) THEN
    CREATE POLICY "service_insert_board_resolutions"
      ON board_resolutions FOR INSERT TO service_role
      WITH CHECK (true);
  END IF;
END $$;
