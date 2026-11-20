-- Device detail enrichment for the trusted-device registry.
--
-- Browsers cannot expose a hardware MAC address, so blocking is keyed on the
-- server-derived `deviceKey` (never the IP). These columns record the strongest
-- per-device signals a browser does expose — operating system and version,
-- device model and vendor, CPU architecture, screen, GPU renderer, memory and
-- CPU cores, plus a persisted client id and a stable display "HW ID" — so a
-- customer or administrator can recognise and target the exact phone or laptop
-- even when several devices share one IP address.
--
-- Idempotent and additive, so it is safe to replay.
ALTER TABLE `trusted_devices`
  ADD COLUMN IF NOT EXISTS `osName` varchar(48) NULL AFTER `browser`,
  ADD COLUMN IF NOT EXISTS `osVersion` varchar(32) NULL AFTER `osName`,
  ADD COLUMN IF NOT EXISTS `model` varchar(64) NULL AFTER `osVersion`,
  ADD COLUMN IF NOT EXISTS `vendor` varchar(48) NULL AFTER `model`,
  ADD COLUMN IF NOT EXISTS `architecture` varchar(24) NULL AFTER `vendor`,
  ADD COLUMN IF NOT EXISTS `screen` varchar(24) NULL AFTER `architecture`,
  ADD COLUMN IF NOT EXISTS `gpuRenderer` varchar(160) NULL AFTER `screen`,
  ADD COLUMN IF NOT EXISTS `cpuCores` int NULL AFTER `gpuRenderer`,
  ADD COLUMN IF NOT EXISTS `deviceMemoryGb` int NULL AFTER `cpuCores`,
  ADD COLUMN IF NOT EXISTS `clientId` varchar(64) NULL AFTER `deviceMemoryGb`,
  ADD COLUMN IF NOT EXISTS `hardwareId` varchar(32) NULL AFTER `clientId`;
