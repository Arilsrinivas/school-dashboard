ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'ready';
ALTER TABLE uploaded_files
  ADD CONSTRAINT uploaded_files_upload_status_check
  CHECK (upload_status IN ('pending_upload','ready','failed'));
CREATE INDEX IF NOT EXISTS uploaded_files_pending_idx ON uploaded_files(created_at) WHERE upload_status='pending_upload';
