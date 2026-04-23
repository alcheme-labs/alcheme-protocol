UPDATE "circles"
SET "genesis_mode" = CASE
  WHEN "genesis_mode" IN ('Seeded', 'SEEDED') THEN 'SEEDED'
  ELSE 'BLANK'
END;
