-- Trusted devices and device access audit trail.
--
-- Adds the device registry behind the customer portal "Trusted Devices" menu and
-- the admin "Device Oversight" queue. Browsers cannot expose a hardware MAC
-- address, so `deviceKey` is a stable, server-derived pseudonymous fingerprint
-- that differentiates one device from another for the same account.
--
-- Idempotent and additive, so it is safe to replay.
CREATE TABLE IF NOT EXISTS `trusted_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `deviceKey` varchar(96) NOT NULL,
  `deviceName` varchar(120) NOT NULL DEFAULT 'Unknown device',
  `deviceType` varchar(32) NOT NULL DEFAULT 'unknown',
  `platform` varchar(64) NULL,
  `browser` varchar(64) NULL,
  `userAgent` text NULL,
  `firstIpAddress` varchar(128) NULL,
  `lastIpAddress` varchar(128) NULL,
  `countryCode` varchar(8) NULL,
  `status` enum('trusted','pending','blocked') NOT NULL DEFAULT 'trusted',
  `blockedBy` enum('customer','admin') NULL,
  `blockedReason` varchar(255) NULL,
  `blockedAt` timestamp NULL,
  `restoredAt` timestamp NULL,
  `loginCount` int NOT NULL DEFAULT 0,
  `firstSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `trusted_devices_user_key_uq` (`userId`,`deviceKey`),
  KEY `trusted_devices_user_status_idx` (`userId`,`status`),
  KEY `trusted_devices_status_idx` (`status`,`lastSeenAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `device_access_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `deviceKey` varchar(96) NULL,
  `deviceName` varchar(120) NULL,
  `action` varchar(40) NOT NULL,
  `actorRole` varchar(16) NOT NULL DEFAULT 'customer',
  `actorId` int NULL,
  `detail` varchar(500) NULL,
  `ipAddress` varchar(128) NULL,
  `userAgent` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `device_access_events_user_created_idx` (`userId`,`createdAt`),
  KEY `device_access_events_device_idx` (`deviceKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
