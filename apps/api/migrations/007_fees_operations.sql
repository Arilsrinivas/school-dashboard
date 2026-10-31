-- Extend school fee configuration and preserve payments as an append-only ledger.
ALTER TABLE fee_categories
  ADD COLUMN category_type text NOT NULL DEFAULT 'custom'
    CHECK (category_type IN ('tuition','transport','examination','custom')),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE fee_structures
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'INR'
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN description text NOT NULL DEFAULT ''
    CHECK (length(description) <= 1000),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE student_fees
  ADD COLUMN due_on date,
  ADD COLUMN assigned_by uuid,
  ADD COLUMN assigned_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT student_fees_assigner_tenant_fk
    FOREIGN KEY (school_id, assigned_by) REFERENCES school_memberships(school_id, id),
  ADD CONSTRAINT student_fees_school_student_structure_uidx
    UNIQUE (school_id, student_id, fee_structure_id);

ALTER TABLE payments
  ADD COLUMN idempotency_key text,
  ADD CONSTRAINT payments_school_idempotency_uidx
    UNIQUE (school_id, idempotency_key);

CREATE TABLE fee_receipt_sequences (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),
  idempotency_key text NOT NULL,
  reversed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (school_id, idempotency_key),
  FOREIGN KEY (school_id, payment_id) REFERENCES payments(school_id, id),
  FOREIGN KEY (school_id, reversed_by) REFERENCES school_memberships(school_id, id)
);
CREATE INDEX payment_reversals_school_payment_idx ON payment_reversals(school_id, payment_id, created_at);
CREATE INDEX payments_school_paid_at_idx ON payments(school_id, paid_at DESC, student_fee_id);
CREATE INDEX student_fees_school_student_idx ON student_fees(school_id, student_id, is_active);
CREATE INDEX student_fees_school_due_idx ON student_fees(school_id, due_on) WHERE is_active;
CREATE INDEX fee_structures_school_year_idx ON fee_structures(school_id, academic_year_id, category_id);

ALTER TABLE fee_receipt_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fee_receipt_sequences
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_reversals
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);

CREATE FUNCTION prevent_fee_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('TRUNCATE','UPDATE') OR (TG_OP='DELETE' AND pg_trigger_depth()<=1) THEN
    RAISE EXCEPTION 'fee ledger is append-only';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER payments_immutable
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payments_no_truncate
  BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payment_reversals_immutable
  BEFORE UPDATE OR DELETE ON payment_reversals
  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payment_reversals_no_truncate
  BEFORE TRUNCATE ON payment_reversals
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payment_receipts_immutable
  BEFORE UPDATE OR DELETE ON payment_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_fee_ledger_mutation();
CREATE TRIGGER payment_receipts_no_truncate
  BEFORE TRUNCATE ON payment_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_fee_ledger_mutation();
