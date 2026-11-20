-- Persist a whitelisted customer-card theme with each Mining package version.
-- Existing and newly seeded versions retain the Aurora default.

ALTER TABLE mining_package_versions
  ADD COLUMN IF NOT EXISTS themeKey VARCHAR(32) NOT NULL DEFAULT 'aurora';
