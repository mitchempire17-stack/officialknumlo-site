-- OPTIONAL demo data for testing only. Do not load in production.
INSERT INTO members (first_name,last_name,id_number,phone,email,cadre_id,designation,sector_code,county_id,workstation,employer_id,password_hash)
VALUES ('Amina','Wanjiru','12345678','+254712345678','amina@example.com',1,'Medical Laboratory Officer','CPS',47,'Pumwani Hospital',NULL,'REPLACE_WITH_HASH'),
       ('Brian','Otieno','23456789','+254722000111','brian@example.com',2,'Medical Laboratory Technologist','MISS',44,'Migori Mission Hospital',NULL,'REPLACE_WITH_HASH'),
       ('Cate','Kiptoo','34567890','+254733000222','cate@example.com',1,'Medical Laboratory Officer','PAR',30,'MTRH Laboratory',(SELECT id FROM employers WHERE code='MTRH'),'REPLACE_WITH_HASH');
SELECT approve_member(id) FROM members ORDER BY created_at, first_name;
SELECT generate_monthly_invoices('2026-10-01');
SELECT record_c2b_payment('SLK1TEST01', now(), 450, 'knumlo/cps/001/047', '254712345678', 'AMINA WANJIRU', '{}'::jsonb);
