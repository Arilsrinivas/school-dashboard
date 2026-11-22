-- Apply FORCE RLS to tenant tables introduced after the initial security sweep.
-- Keep this as a forward migration so databases that already applied 010 can upgrade safely.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'school_memberships',
    'users',
    'attendance_history',
    'assignment_attachments',
    'assignment_audit_history',
    'examination_grading_scales',
    'examination_audit_history',
    'timetable_periods',
    'timetable_audit_history',
    'fee_receipt_sequences',
    'payment_reversals',
    'announcement_audit_history'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;
