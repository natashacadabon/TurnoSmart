-- Express owns domain access. Browser clients use Supabase Auth only.
BEGIN;

DO $$
DECLARE
  table_name text;
  relation regclass;
  columns text;
  api_role text;
  privilege text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'businesses', 'profiles', 'customers', 'services', 'availability_rules',
    'appointments', 'appointment_events', 'risk_scores', 'reminders'
  ]
  LOOP
    relation := format('public.%I', table_name)::regclass;
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated', relation);

    -- Table-level revocation alone does not remove independent column grants.
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
      INTO columns
      FROM pg_attribute
      WHERE attrelid = relation AND attnum > 0 AND NOT attisdropped;
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE %s FROM PUBLIC, anon, authenticated',
      columns, relation
    );

    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      -- Test every table privilege supported by this PostgreSQL version.
      FOR privilege IN
        SELECT DISTINCT privilege_type FROM aclexplode(acldefault('r', current_user::regrole))
      LOOP
        IF has_table_privilege(api_role, relation, privilege) THEN
          RAISE EXCEPTION 'SA01: % retains % on %', api_role, privilege, relation;
        END IF;
      END LOOP;
      IF has_any_column_privilege(api_role, relation, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'SA01: % retains column privileges on %', api_role, relation;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- The RLS helper is not a browser RPC. Keep the existing service_role grant.
REVOKE EXECUTE ON FUNCTION public.current_business_id() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.current_business_id()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.current_business_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SA01: browser role retains EXECUTE on public.current_business_id()';
  END IF;
END
$$;

COMMIT;
