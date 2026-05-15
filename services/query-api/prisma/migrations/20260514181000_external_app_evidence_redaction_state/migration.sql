ALTER TABLE "external_app_evidence_receipts"
  ADD COLUMN "redaction_state" VARCHAR(32) NOT NULL DEFAULT 'none';
