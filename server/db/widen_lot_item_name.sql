-- An award's items are copied from its PR's items, so a lot item name holds
-- as much as a PR item name (VARCHAR(500)). Widening only: no data changes,
-- and running it again is harmless.
ALTER TABLE lot_items MODIFY item_name VARCHAR(500) NOT NULL;
