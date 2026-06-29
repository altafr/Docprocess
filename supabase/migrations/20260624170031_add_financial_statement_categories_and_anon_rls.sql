-- Add three specific financial statement categories
INSERT INTO document_categories (user_id, name, description, color, is_default) VALUES
  (NULL, 'Balance Sheet',            'Financial statement showing a company''s assets, liabilities, and shareholders'' equity at a specific point in time.', 'stone', true),
  (NULL, 'Profit & Loss Statement',  'Income statement showing revenues, costs, expenses, and net profit or loss over a reporting period. Also known as P&L or income statement.', 'pink', true),
  (NULL, 'Cash Flow Statement',      'Financial statement showing the movement of cash in and out of a business across operating, investing, and financing activities.', 'zinc', true)
ON CONFLICT DO NOTHING;

-- Allow anonymous (unauthenticated) users to read all categories (needed for CategoryManager UI)
CREATE POLICY "anon_select_document_categories"
  ON document_categories FOR SELECT
  TO anon USING (true);

-- Allow anon to insert new custom categories (user_id must be NULL since there is no auth)
CREATE POLICY "anon_insert_document_categories"
  ON document_categories FOR INSERT
  TO anon WITH CHECK (user_id IS NULL);

-- Allow anon to update any category (description, color, name for custom categories)
CREATE POLICY "anon_update_document_categories"
  ON document_categories FOR UPDATE
  TO anon USING (true) WITH CHECK (true);

-- Allow anon to delete only non-default (user-created) categories
CREATE POLICY "anon_delete_document_categories"
  ON document_categories FOR DELETE
  TO anon USING (is_default = false);
