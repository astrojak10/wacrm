import { describe, expect, it } from 'vitest';
import { parseFlowFile, serializeFlowFile, type FlowFileData } from './file';

const sample: FlowFileData = {
  name: 'Welcome',
  description: 'A small welcome flow.',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['hello'] },
  entry_node_id: 'start',
  fallback_policy: {
    on_unknown_reply: 'reprompt',
    max_reprompts: 2,
    on_timeout_hours: 24,
    on_exhaust: 'handoff',
  },
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'done' },
      position_x: 20,
      position_y: 40,
    },
    {
      node_key: 'done',
      node_type: 'end',
      config: {},
      position_x: 300,
      position_y: 40,
    },
  ],
};

describe('flow file round trip', () => {
  it('serializes and parses portable flow data', () => {
    const file = serializeFlowFile(sample);
    expect(file).toContain('"format": "wacrm-flow"');
    expect(file).not.toContain('"user_id"');
    const envelope = JSON.parse(file);
    expect(envelope.flow).not.toHaveProperty('id');
    expect(envelope.flow).not.toHaveProperty('account_id');
    expect(envelope.flow).not.toHaveProperty('status');
    expect(parseFlowFile(file)).toEqual(sample);
  });

  it('rejects malformed JSON and unsupported versions', () => {
    expect(() => parseFlowFile('{')).toThrow('not valid JSON');
    const file = JSON.parse(serializeFlowFile(sample));
    file.version = 99;
    expect(() => parseFlowFile(JSON.stringify(file))).toThrow(
      'version is not supported'
    );
  });

  it('rejects empty graphs, duplicate keys, unsupported node types, and dangling edges', () => {
    const file = JSON.parse(serializeFlowFile(sample));
    file.flow.nodes = [];
    expect(() => parseFlowFile(JSON.stringify(file))).toThrow(
      'at least one node'
    );

    file.flow.nodes = [sample.nodes[0], sample.nodes[0]];
    expect(() => parseFlowFile(JSON.stringify(file))).toThrow(
      'node keys must be unique'
    );

    file.flow.nodes = [{ ...sample.nodes[0], node_type: 'unknown' }];
    expect(() => parseFlowFile(JSON.stringify(file))).toThrow(
      'unsupported type'
    );

    file.flow.nodes = [
      { ...sample.nodes[0], config: { next_node_key: 'missing' } },
    ];
    expect(() => parseFlowFile(JSON.stringify(file))).toThrow('missing node');
  });

  it('rejects files above the size limit', () => {
    expect(() => parseFlowFile(' '.repeat(2 * 1024 * 1024 + 1))).toThrow(
      '2 MB limit'
    );
  });
});
