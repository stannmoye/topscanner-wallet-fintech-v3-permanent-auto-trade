-- Tender Bid — Stage 8 source-registry expansion.
--
-- Adds the 27 further national sources to the tender-source registry seeded by
-- `0125_tender_bid.sql` (Ukraine, Brazil, Chile, Colombia, South Korea, Peru,
-- Kazakhstan, Türkiye, Mexico, China, Japan, Indonesia, the Philippines,
-- Vietnam, Bangladesh, Pakistan, Egypt, Morocco, Tunisia, Uganda, Tanzania,
-- Ethiopia, Sri Lanka, Nepal, Moldova, Georgia and Serbia). The tables already
-- exist from stage 1; this migration is a forward-only, idempotent, additive
-- seed.
--
-- Idempotent and additive, so it is safe to replay. Descriptive fields are
-- refreshed on replay, but `enabled`, `configJson`, and the health columns are
-- never overwritten, so an administrator's enable/disable choice and any recorded
-- sync health survive.
INSERT INTO `tender_sources` (`key`, `label`, `countryCode`, `kind`, `adapter`) VALUES
  ('ua_prozorro', 'Prozorro (Ukraine)', 'UA', 'government', 'prozorro'),
  ('br_pncp', 'PNCP Portal Nacional de Contratacoes Publicas (Brazil)', 'BR', 'government', 'pncp'),
  ('cl_mercado_publico', 'Mercado Publico (Chile)', 'CL', 'government', 'mercado_publico'),
  ('co_secop_ii', 'SECOP II (Colombia)', 'CO', 'government', 'secop_ii'),
  ('kr_koneps', 'KONEPS / nara-jangteo (South Korea)', 'KR', 'government', 'koneps'),
  ('pe_oece', 'OECE Contrataciones Abiertas (Peru)', 'PE', 'government', 'oece'),
  ('kz_goszakup', 'Goszakup (Kazakhstan)', 'KZ', 'government', 'goszakup'),
  ('tr_ekap', 'EKAP Elektronik Kamu Alimlari Platformu (Turkiye)', 'TR', 'government', 'ekap'),
  ('mx_comprasmx', 'ComprasMX (Mexico)', 'MX', 'government', 'comprasmx'),
  ('cn_ccgp', 'China Government Procurement (CCGP)', 'CN', 'government', 'ccgp'),
  ('jp_kkj', 'Kokusai Chotatsu Joho (KKJ, Japan)', 'JP', 'government', 'kkj'),
  ('id_spse', 'SPSE / LPSE (Indonesia)', 'ID', 'government', 'spse'),
  ('ph_philgeps', 'PhilGEPS (Philippines)', 'PH', 'government', 'philgeps'),
  ('vn_muasamcong', 'MuaSamCong (Vietnam)', 'VN', 'government', 'muasamcong'),
  ('bd_eprocure', 'e-Procurement (Bangladesh)', 'BD', 'government', 'eprocure_bd'),
  ('pk_epms', 'EPMS / PPRA (Pakistan)', 'PK', 'government', 'pakistan_epms'),
  ('eg_etenders', 'Government e-Tenders Portal (Egypt)', 'EG', 'government', 'egypt_etenders'),
  ('ma_marchespublics', 'MarchesPublics (Morocco)', 'MA', 'government', 'marchespublics'),
  ('tn_tuneps', 'TUNEPS (Tunisia)', 'TN', 'government', 'tuneps'),
  ('ug_gpp', 'Government Procurement Portal (Uganda)', 'UG', 'government', 'gpp_uganda'),
  ('tz_nest', 'NeST National e-Procurement System (Tanzania)', 'TZ', 'government', 'nest'),
  ('et_egp', 'Electronic Government Procurement (Ethiopia)', 'ET', 'government', 'egp_ethiopia'),
  ('lk_treasury', 'Treasury Procurement Notices (Sri Lanka)', 'LK', 'government', 'treasury_lk'),
  ('np_bolpatra', 'Bolpatra e-GP (Nepal)', 'NP', 'government', 'bolpatra'),
  ('md_mtender', 'MTender (Moldova)', 'MD', 'government', 'mtender'),
  ('ge_procurement', 'State Procurement Agency (Georgia)', 'GE', 'government', 'georgia_procurement'),
  ('rs_portal', 'Public Procurement Portal (Serbia)', 'RS', 'government', 'rs_portal')
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `countryCode` = VALUES(`countryCode`),
  `kind` = VALUES(`kind`),
  `adapter` = VALUES(`adapter`);
