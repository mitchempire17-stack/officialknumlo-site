-- Reference data. Run after 01_schema.sql.
INSERT INTO counties (id, name) VALUES
(1,'Mombasa'),(2,'Kwale'),(3,'Kilifi'),(4,'Tana River'),(5,'Lamu'),(6,'Taita-Taveta'),(7,'Garissa'),(8,'Wajir'),
(9,'Mandera'),(10,'Marsabit'),(11,'Isiolo'),(12,'Meru'),(13,'Tharaka-Nithi'),(14,'Embu'),(15,'Kitui'),(16,'Machakos'),
(17,'Makueni'),(18,'Nyandarua'),(19,'Nyeri'),(20,'Kirinyaga'),(21,'Murang''a'),(22,'Kiambu'),(23,'Turkana'),(24,'West Pokot'),
(25,'Samburu'),(26,'Trans Nzoia'),(27,'Uasin Gishu'),(28,'Elgeyo-Marakwet'),(29,'Nandi'),(30,'Baringo'),(31,'Laikipia'),
(32,'Nakuru'),(33,'Narok'),(34,'Kajiado'),(35,'Kericho'),(36,'Bomet'),(37,'Kakamega'),(38,'Vihiga'),(39,'Bungoma'),
(40,'Busia'),(41,'Siaya'),(42,'Kisumu'),(43,'Homa Bay'),(44,'Migori'),(45,'Kisii'),(46,'Nyamira'),(47,'Nairobi');

INSERT INTO branches (name, county_id) SELECT name || ' Branch', id FROM counties;

INSERT INTO cadres (name) VALUES
('Medical Laboratory Officer'),('Medical Laboratory Technologist'),('Medical Laboratory Technician'),('Intern');

-- Placeholder monthly dues of KES 300 for all cadres. Change to the real amount.
INSERT INTO dues_plans (name, amount_kes, effective_from) VALUES ('Standard monthly dues', 500, '2026-01-01');

INSERT INTO leaders (full_name, position, display_order) VALUES
('Full Name','National Chairperson',1),('Full Name','Secretary General',2),
('Full Name','National Treasurer',3),('Full Name','Organising Secretary',4);
