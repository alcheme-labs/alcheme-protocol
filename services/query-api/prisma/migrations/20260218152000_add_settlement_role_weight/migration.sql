ALTER TABLE "settlement_history"
  ADD COLUMN "contribution_role" VARCHAR(32),
  ADD COLUMN "contribution_weight" DECIMAL(10,4);

CREATE INDEX "settlement_history_contribution_role_idx"
  ON "settlement_history"("contribution_role");
