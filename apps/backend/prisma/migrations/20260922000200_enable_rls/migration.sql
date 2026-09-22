-- Supabase RLS baseline.
-- Profile ids must match auth.users.id. Business/profile provisioning remains a
-- trusted backend operation until the authentication onboarding flow exists.
-- No policies are granted to anon.

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT business_id
  FROM public.profiles
  WHERE id = (SELECT auth.uid())
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_business_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_business_id() TO service_role;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.businesses, public.profiles, public.customers,
  public.services, public.availability_rules, public.appointments,
  public.appointment_events, public.risk_scores, public.reminders FROM anon;

GRANT SELECT ON TABLE public.businesses, public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers, public.services,
  public.availability_rules, public.appointments, public.appointment_events,
  public.risk_scores, public.reminders TO authenticated;

CREATE POLICY "business members can read their business"
ON public.businesses
FOR SELECT
TO authenticated
USING (id = (SELECT public.current_business_id()));

CREATE POLICY "business members can read profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (business_id = (SELECT public.current_business_id()));

CREATE POLICY "business members manage customers"
ON public.customers
FOR ALL
TO authenticated
USING (business_id = (SELECT public.current_business_id()))
WITH CHECK (business_id = (SELECT public.current_business_id()));

CREATE POLICY "business members manage services"
ON public.services
FOR ALL
TO authenticated
USING (business_id = (SELECT public.current_business_id()))
WITH CHECK (business_id = (SELECT public.current_business_id()));

CREATE POLICY "business members manage availability"
ON public.availability_rules
FOR ALL
TO authenticated
USING (business_id = (SELECT public.current_business_id()))
WITH CHECK (business_id = (SELECT public.current_business_id()));

CREATE POLICY "business members manage appointments"
ON public.appointments
FOR ALL
TO authenticated
USING (business_id = (SELECT public.current_business_id()))
WITH CHECK (business_id = (SELECT public.current_business_id()));

CREATE POLICY "business members manage appointment events"
ON public.appointment_events
FOR ALL
TO authenticated
USING (business_id = (SELECT public.current_business_id()))
WITH CHECK (business_id = (SELECT public.current_business_id()));

CREATE POLICY "business members manage risk scores"
ON public.risk_scores
FOR ALL
TO authenticated
USING (business_id = (SELECT public.current_business_id()))
WITH CHECK (business_id = (SELECT public.current_business_id()));

CREATE POLICY "business members manage reminders"
ON public.reminders
FOR ALL
TO authenticated
USING (business_id = (SELECT public.current_business_id()))
WITH CHECK (business_id = (SELECT public.current_business_id()));
