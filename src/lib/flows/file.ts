import type { FlowFallbackPolicy, FlowNodeType } from './types';

export const FLOW_FILE_FORMAT = 'wacrm-flow';
export const FLOW_FILE_VERSION = 1;
export const MAX_FLOW_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FLOW_NODES = 500;
const MAX_POSITION = 1_000_000;

const NODE_TYPES: FlowNodeType[] = [
  'start',
  'send_message',
  'send_buttons',
  'send_list',
  'send_media',
  'send_location',
  'request_location',
  'collect_input',
  'condition',
  'set_tag',
  'razorpay_payment',
  'handoff',
  'end',
];

export interface FlowFileNode {
  node_key: string;
  node_type: FlowNodeType;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
}

export interface FlowFileData {
  name: string;
  description: string;
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: FlowFallbackPolicy;
  nodes: FlowFileNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(reason: string): never {
  throw new Error(`Invalid flow file: ${reason}`);
}

function parseFallbackPolicy(value: unknown): FlowFallbackPolicy {
  if (!isRecord(value)) return invalid('fallback policy is missing');
  const { on_unknown_reply, max_reprompts, on_timeout_hours, on_exhaust } =
    value;
  if (
    on_unknown_reply !== 'reprompt' &&
    on_unknown_reply !== 'handoff' &&
    on_unknown_reply !== 'ignore'
  ) {
    return invalid('fallback policy has an invalid unknown-reply action');
  }
  if (on_exhaust !== 'handoff' && on_exhaust !== 'end') {
    return invalid('fallback policy has an invalid exhaustion action');
  }
  if (
    typeof max_reprompts !== 'number' ||
    !Number.isInteger(max_reprompts) ||
    max_reprompts < 0 ||
    max_reprompts > 100
  ) {
    return invalid('fallback policy has an invalid reprompt limit');
  }
  if (
    typeof on_timeout_hours !== 'number' ||
    !Number.isFinite(on_timeout_hours) ||
    on_timeout_hours < 1 ||
    on_timeout_hours > 8760
  ) {
    return invalid('fallback policy has an invalid timeout');
  }
  return {
    on_unknown_reply:
      on_unknown_reply as FlowFallbackPolicy['on_unknown_reply'],
    max_reprompts,
    on_timeout_hours,
    on_exhaust: on_exhaust as FlowFallbackPolicy['on_exhaust'],
  };
}

function collectReferences(node: FlowFileNode): string[] {
  const config = node.config;
  const refs: string[] = [];
  const add = (value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value !== 'string')
      invalid(`node "${node.node_key}" has a non-text edge`);
    refs.push(value);
  };
  const readRows = (rows: unknown) => {
    if (rows === undefined) return;
    if (!Array.isArray(rows))
      invalid(`node "${node.node_key}" has malformed options`);
    for (const row of rows) {
      if (!isRecord(row))
        invalid(`node "${node.node_key}" has malformed options`);
      add(row.next_node_key);
    }
  };

  switch (node.node_type) {
    case 'start':
    case 'send_message':
    case 'send_media':
    case 'send_location':
    case 'request_location':
    case 'collect_input':
    case 'set_tag':
      add(config.next_node_key);
      break;
    case 'send_buttons':
      readRows(config.buttons);
      break;
    case 'send_list':
      if (config.sections !== undefined) {
        if (!Array.isArray(config.sections))
          invalid(`node "${node.node_key}" has malformed sections`);
        for (const section of config.sections) {
          if (!isRecord(section))
            invalid(`node "${node.node_key}" has malformed sections`);
          readRows(section.rows);
        }
      }
      break;
    case 'condition':
      add(config.true_next);
      add(config.false_next);
      break;
    case 'razorpay_payment':
      add(config.success_next);
      add(config.failure_next);
      break;
    case 'handoff':
    case 'end':
      break;
  }
  return refs;
}

export function serializeFlowFile(flow: FlowFileData): string {
  return `${JSON.stringify(
    {
      format: FLOW_FILE_FORMAT,
      version: FLOW_FILE_VERSION,
      exported_at: new Date().toISOString(),
      flow,
    },
    null,
    2
  )}\n`;
}

export function parseFlowFile(text: string): FlowFileData {
  if (new TextEncoder().encode(text).byteLength > MAX_FLOW_FILE_BYTES) {
    return invalid('file exceeds the 2 MB limit');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid('file is not valid JSON');
  }
  if (!isRecord(parsed) || parsed.format !== FLOW_FILE_FORMAT) {
    return invalid('file was not exported by WACRM');
  }
  if (parsed.version !== FLOW_FILE_VERSION) {
    return invalid('file version is not supported');
  }
  if (!isRecord(parsed.flow)) return invalid('flow data is missing');

  const flow = parsed.flow;
  if (typeof flow.name !== 'string' || !flow.name.trim()) {
    return invalid('flow name is missing');
  }
  if (typeof flow.description !== 'string') {
    return invalid('flow description is invalid');
  }
  if (
    flow.trigger_type !== 'keyword' &&
    flow.trigger_type !== 'first_inbound_message' &&
    flow.trigger_type !== 'manual'
  ) {
    return invalid('trigger type is not supported');
  }
  if (!isRecord(flow.trigger_config))
    return invalid('trigger configuration is invalid');
  if (
    flow.entry_node_id !== null &&
    (typeof flow.entry_node_id !== 'string' || !flow.entry_node_id.trim())
  ) {
    return invalid('entry node is invalid');
  }
  if (!Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    return invalid('file must contain at least one node');
  }
  if (flow.nodes.length > MAX_FLOW_NODES)
    return invalid('file contains too many nodes');

  const seen = new Set<string>();
  const nodes = flow.nodes.map((value): FlowFileNode => {
    if (!isRecord(value)) return invalid('node data is malformed');
    const { node_key, node_type, config, position_x, position_y } = value;
    if (
      typeof node_key !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(node_key) ||
      seen.has(node_key)
    ) {
      return invalid(
        'node keys must be unique and use letters, numbers, _ or -'
      );
    }
    seen.add(node_key);
    if (
      typeof node_type !== 'string' ||
      !NODE_TYPES.includes(node_type as FlowNodeType)
    ) {
      return invalid(`node "${node_key}" has an unsupported type`);
    }
    if (!isRecord(config))
      return invalid(`node "${node_key}" has invalid configuration`);
    const x = position_x ?? 0;
    const y = position_y ?? 0;
    if (
      typeof x !== 'number' ||
      !Number.isInteger(x) ||
      Math.abs(x) > MAX_POSITION ||
      typeof y !== 'number' ||
      !Number.isInteger(y) ||
      Math.abs(y) > MAX_POSITION
    ) {
      return invalid(`node "${node_key}" has an invalid canvas position`);
    }
    return {
      node_key,
      node_type: node_type as FlowNodeType,
      config,
      position_x: x,
      position_y: y,
    };
  });

  const keys = new Set(nodes.map((node) => node.node_key));
  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    return invalid('entry node does not exist in the graph');
  }
  for (const node of nodes) {
    if (collectReferences(node).some((key) => !keys.has(key))) {
      return invalid(`node "${node.node_key}" points to a missing node`);
    }
  }

  return {
    name: flow.name,
    description: flow.description,
    trigger_type: flow.trigger_type,
    trigger_config: flow.trigger_config,
    entry_node_id: flow.entry_node_id,
    fallback_policy: parseFallbackPolicy(flow.fallback_policy),
    nodes,
  };
}
