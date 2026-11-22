ALTER TABLE uploaded_files DROP CONSTRAINT IF EXISTS uploaded_files_purpose_check;
DROP INDEX IF EXISTS uploaded_files_school_purpose_idx;
ALTER TABLE uploaded_files DROP COLUMN IF EXISTS resource_id, DROP COLUMN IF EXISTS purpose;
