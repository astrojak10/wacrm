-- Save flow metadata and its node graph in one transaction. In particular,
-- an invalid node insert must not leave the previously saved graph deleted.
CREATE OR REPLACE FUNCTION public.save_flow(
  p_flow_id UUID,
  p_flow_patch JSONB,
  p_nodes JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(p_flow_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'p_flow_patch must be a JSON object';
  END IF;
  IF p_nodes IS NOT NULL AND jsonb_typeof(p_nodes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_nodes must be a JSON array';
  END IF;

  UPDATE public.flows AS f
  SET
    name = CASE WHEN p_flow_patch ? 'name' THEN p_flow_patch->>'name' ELSE f.name END,
    description = CASE WHEN p_flow_patch ? 'description' THEN p_flow_patch->>'description' ELSE f.description END,
    trigger_type = CASE WHEN p_flow_patch ? 'trigger_type' THEN p_flow_patch->>'trigger_type' ELSE f.trigger_type END,
    trigger_config = CASE WHEN p_flow_patch ? 'trigger_config' THEN p_flow_patch->'trigger_config' ELSE f.trigger_config END,
    entry_node_id = CASE WHEN p_flow_patch ? 'entry_node_id' THEN p_flow_patch->>'entry_node_id' ELSE f.entry_node_id END,
    fallback_policy = CASE WHEN p_flow_patch ? 'fallback_policy' THEN p_flow_patch->'fallback_policy' ELSE f.fallback_policy END,
    updated_at = NOW()
  WHERE f.id = p_flow_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow not found';
  END IF;

  IF p_nodes IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.flow_nodes WHERE flow_id = p_flow_id;

  INSERT INTO public.flow_nodes (
    flow_id, node_key, node_type, config, position_x, position_y
  )
  SELECT
    p_flow_id,
    n.node_key,
    n.node_type,
    COALESCE(n.config, '{}'::jsonb),
    COALESCE(n.position_x, 0),
    COALESCE(n.position_y, 0)
  FROM jsonb_to_recordset(p_nodes) AS n(
    node_key TEXT,
    node_type TEXT,
    config JSONB,
    position_x INTEGER,
    position_y INTEGER
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_flow(UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_flow(UUID, JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.save_flow(UUID, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_flow(UUID, JSONB, JSONB) TO service_role;