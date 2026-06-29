/*
  # Create document_categories table

  1. New Tables
    - `document_categories`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users) - NULL = system default visible to all
      - `name` (text, not null)
      - `description` (text) - hint used in the AI classification prompt
      - `color` (text) - Tailwind color token
      - `is_default` (boolean)
      - `created_at` (timestamptz)

  2. Security
    - RLS enabled
    - Authenticated users can read their own + all system defaults
    - Users can only insert/update/delete their own rows
*/

CREATE TABLE IF NOT EXISTS document_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'gray',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own and default categories"
  ON document_categories FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can insert own categories"
  ON document_categories FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own categories"
  ON document_categories FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own categories"
  ON document_categories FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_document_categories_user_id ON document_categories(user_id);

-- Seed default categories (user_id = NULL means available to everyone)
INSERT INTO document_categories (user_id, name, description, color, is_default) VALUES
  (NULL, 'Utility Bill',         'Electricity, water, gas, internet or other utility statements showing account number, billing period and amount due.', 'sky', true),
  (NULL, 'BR Certificate',       'Business Registration or Certificate of Incorporation issued by a government authority, listing company name, registration number and directors.', 'emerald', true),
  (NULL, 'Bank Statement',       'Monthly or periodic account statement from a bank showing transactions, balances and account holder details.', 'blue', true),
  (NULL, 'Invoice',              'Commercial invoice from a supplier or vendor listing items, quantities, unit prices and total amount payable.', 'amber', true),
  (NULL, 'Receipt',              'Proof-of-payment receipt or till slip confirming a transaction has been completed.', 'orange', true),
  (NULL, 'Tax Document',         'Tax assessment, tax return, NOA or any document issued by a tax authority.', 'rose', true),
  (NULL, 'Identity Document',    'Passport, national ID card, driving licence or other government-issued identity document.', 'cyan', true),
  (NULL, 'Insurance Document',   'Insurance policy, renewal notice, certificate of insurance or claims document.', 'teal', true),
  (NULL, 'Contract / Agreement', 'Signed legal contract, service agreement, MOU or any binding document between two or more parties.', 'slate', true),
  (NULL, 'Letter / Correspondence', 'Formal or informal letter, memo or written communication addressed to an individual or organisation.', 'gray', true),
  (NULL, 'Financial Report',     'Annual report, financial statement, balance sheet, P&L or audit report of a company.', 'green', true),
  (NULL, 'Application Form',     'Printed or scanned form filled in by an applicant, such as a loan application or account opening form.', 'lime', true)
ON CONFLICT DO NOTHING;
