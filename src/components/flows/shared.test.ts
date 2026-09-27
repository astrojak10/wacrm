import { describe, expect, it } from 'vitest';

import {
  NODE_CATEGORIES,
  NODE_META,
  findHttpsLink,
  groupNodeTypesByCategory,
  type NodeType,
} from './shared';

const ALL_TYPES = Object.keys(NODE_META) as NodeType[];

describe('node categories', () => {
  it('assigns every node type to a known category', () => {
    const known = new Set(NODE_CATEGORIES);
    for (const type of ALL_TYPES) {
      expect(known.has(NODE_META[type].category)).toBe(true);
    }
  });
});

describe('groupNodeTypesByCategory', () => {
  it('keeps the categories in NODE_CATEGORIES order and drops empty ones', () => {
    // Only messaging + flow types — the logic group must not appear.
    const groups = groupNodeTypesByCategory(['send_message', 'start', 'end']);
    expect(groups.map((g) => g.id)).toEqual(['messaging', 'flow']);
  });

  it('preserves the input order within a category', () => {
    const groups = groupNodeTypesByCategory([
      'send_media',
      'send_message',
      'send_buttons',
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].types).toEqual([
      'send_media',
      'send_message',
      'send_buttons',
    ]);
  });

  it('partitions the full type list without losing or duplicating a type', () => {
    const grouped = groupNodeTypesByCategory(ALL_TYPES).flatMap((g) => g.types);
    expect([...grouped].sort()).toEqual([...ALL_TYPES].sort());
  });
});

describe('summarizeNode', () => {
  it('shows the CTA label in a send-message node summary', async () => {
    const { summarizeNode } = await import('./shared');
    expect(
      summarizeNode({
        node_key: 'pay_15_min',
        node_type: 'send_message',
        config: {
          text: 'Proceed to pay INR 49',
          url_button: {
            text: 'Pay Now',
            url: 'https://pay.example.test/checkout',
          },
        },
      }),
    ).toBe('Proceed to pay INR 49 · Pay Now');
  });
});

describe('findHttpsLink', () => {
  it('extracts one HTTPS URL and its full source text', () => {
    expect(
      findHttpsLink('Proceed to pay: https://pay.example.test/checkout.'),
    ).toEqual({
      fullMatch: 'https://pay.example.test/checkout.',
      url: 'https://pay.example.test/checkout',
    });
  });

  it('ignores non-HTTPS and malformed links', () => {
    expect(findHttpsLink('http://pay.example.test')).toBeNull();
    expect(findHttpsLink('https://')).toBeNull();
  });
});
