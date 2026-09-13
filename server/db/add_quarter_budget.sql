-- Quarter budget + optional quarter dates.
--
-- quarters.budget is read by quarter management (Quarters page) and by the
-- reports summary. The create-quarter form does not send start/end dates, so
-- those columns must be nullable for quarter creation to work.
--
-- ADD COLUMN IF NOT EXISTS works on MariaDB (XAMPP); safe to re-run.
ALTER TABLE `quarters` ADD COLUMN IF NOT EXISTS `budget` DECIMAL(15,2) NULL AFTER `year`;
ALTER TABLE `quarters` MODIFY COLUMN `start_date` DATE NULL;
ALTER TABLE `quarters` MODIFY COLUMN `end_date`   DATE NULL;
