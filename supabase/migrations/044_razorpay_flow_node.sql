-- Add the Razorpay payment step used by the flow runner.
ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS razorpay_payment_link_id TEXT;

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'send_location',
    'request_location',
    'collect_input',
    'condition',
    'set_tag',
    'razorpay_payment',
    'handoff',
    'http_fetch',
    'end'
  ));