ALTER TABLE uploaded_files
  ADD COLUMN purpose text NOT NULL DEFAULT 'student_document',
  ADD COLUMN resource_id uuid;

ALTER TABLE uploaded_files
  ADD CONSTRAINT uploaded_files_purpose_check
  CHECK (purpose IN ('student_document','student_certificate','student_profile_photo','assignment_attachment','school_document'));

CREATE INDEX uploaded_files_school_purpose_idx
  ON uploaded_files(school_id,purpose,created_at DESC)
  WHERE upload_status='ready';
