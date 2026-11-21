-- Mumbai Civic Lens v1.2.3, P1 audit guards.
-- The lifecycle log is append-oriented and hash-linked. Hash links make edits detectable inside this
-- demonstration; they are not a claim of tamper-proof storage. Destructive privileges (UPDATE, DELETE, TRUNCATE) on the
-- lifecycle log are withheld from the application role in 0003; the CP-00 reset runs as the owner role instead.

-- Canonical text of an event for hashing: entity|sequence|type|occurredAt(UTC)|actor|summary|previousHash-or-GENESIS
CREATE FUNCTION lifecycle_event_hash(
  p_entity text, p_sequence integer, p_type text, p_occurred timestamptz, p_actor text, p_summary text, p_previous text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    p_entity || '|' || p_sequence::text || '|' || p_type || '|' ||
    to_char(p_occurred AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '|' || p_actor || '|' || p_summary || '|' ||
    coalesce(p_previous, 'GENESIS'), 'UTF8')), 'hex')
$$;

-- Rejects UPDATE and DELETE on lifecycle_events.
CREATE FUNCTION forbid_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lifecycle_events is append-only: % is not allowed', TG_OP USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER lifecycle_no_mutation BEFORE UPDATE OR DELETE ON lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

-- Each new event must extend its entity chain: next sequence, previous hash = last hash, correct payload hash.
CREATE FUNCTION lifecycle_chain_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_seq integer;
  last_hash text;
BEGIN
  SELECT sequence, payload_hash INTO last_seq, last_hash
    FROM lifecycle_events WHERE entity_id = NEW.entity_id ORDER BY sequence DESC LIMIT 1;
  IF coalesce(last_seq, 0) + 1 <> NEW.sequence THEN
    RAISE EXCEPTION 'lifecycle event sequence for % must be %', NEW.entity_id, coalesce(last_seq, 0) + 1 USING ERRCODE = '23514';
  END IF;
  IF NEW.previous_hash IS DISTINCT FROM last_hash THEN
    RAISE EXCEPTION 'lifecycle event previous_hash does not match the chain head for %', NEW.entity_id USING ERRCODE = '23514';
  END IF;
  IF NEW.payload_hash <> lifecycle_event_hash(NEW.entity_id, NEW.sequence, NEW.event_type, NEW.occurred_at,
                                              NEW.actor_role, NEW.summary, NEW.previous_hash) THEN
    RAISE EXCEPTION 'lifecycle event payload_hash is not the canonical hash' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lifecycle_chain_guard BEFORE INSERT ON lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION lifecycle_chain_guard();

-- Corrections keep their history: the challenged field, the prior value and the submission time never change,
-- and rows cannot be deleted. Status, notes and version may progress through the correction state machine.
CREATE FUNCTION corrections_preserve_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'corrections cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF NEW.entity_id <> OLD.entity_id OR NEW.field_path <> OLD.field_path OR NEW.prior_value IS DISTINCT FROM OLD.prior_value
     OR NEW.submitted_at <> OLD.submitted_at OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'correction history fields (entity, field, prior value, submission, reason) are preserved' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER corrections_history_guard BEFORE UPDATE OR DELETE ON corrections
  FOR EACH ROW EXECUTE FUNCTION corrections_preserve_history();

-- Verifies the stored chain for one entity (true when every link and hash recomputes).
CREATE FUNCTION lifecycle_chain_is_valid(p_entity text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(bool_and(q.ok), false)
  FROM (
    SELECT e.payload_hash = lifecycle_event_hash(e.entity_id, e.sequence, e.event_type, e.occurred_at, e.actor_role, e.summary, e.previous_hash)
           AND e.previous_hash IS NOT DISTINCT FROM lag(e.payload_hash) OVER (ORDER BY e.sequence) AS ok
    FROM lifecycle_events e WHERE e.entity_id = p_entity
  ) q
$$;
