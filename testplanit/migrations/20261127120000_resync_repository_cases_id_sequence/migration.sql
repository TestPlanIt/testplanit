-- Moves the RepositoryCases id sequence past the highest existing id. CSV imports used to insert
-- cases with ids taken from the file, which left the sequence behind and made every later case
-- creation fail on "RepositoryCases_pkey". Never moves the sequence backward.
DO $$
DECLARE
  seq text := pg_get_serial_sequence('"RepositoryCases"', 'id');
  max_id bigint;
  current_value bigint;
BEGIN
  SELECT MAX("id") INTO max_id FROM "RepositoryCases";
  IF seq IS NULL OR max_id IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format('SELECT last_value FROM %s', seq) INTO current_value;
  IF max_id >= current_value THEN
    PERFORM setval(seq, max_id);
  END IF;
END $$;
