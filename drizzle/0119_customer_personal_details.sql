-- Customer personal details.
--
-- Stores the editable contact/profile attributes a customer maintains from the
-- Account Preferences -> Personal Details page: first name, last name, gender,
-- country, state, address, and telephone. One row per customer, created lazily
-- on first read/write. These are display/contact attributes only and are kept
-- separate from the KYC verification evidence tables.
--
-- Idempotent and additive, so it is safe to replay.
CREATE TABLE IF NOT EXISTS `customer_personal_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `firstName` varchar(80) NULL,
  `lastName` varchar(80) NULL,
  `gender` varchar(32) NULL,
  `country` varchar(80) NULL,
  `state` varchar(120) NULL,
  `address` varchar(255) NULL,
  `telephone` varchar(40) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `customer_personal_details_user_uq` (`userId`)
) ENGINE=InnoDB;
