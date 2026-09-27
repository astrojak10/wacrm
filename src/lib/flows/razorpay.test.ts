import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRazorpayPaymentLink,
  rupeesToPaise,
  verifyRazorpayWebhookSignature,
} from './razorpay';

const originalEnv = {
  keyId: process.env.RAZORPAY_KEY_ID,
  keySecret: process.env.RAZORPAY_KEY_SECRET,
};

afterEach(() => {
  if (originalEnv.keyId === undefined) delete process.env.RAZORPAY_KEY_ID;
  else process.env.RAZORPAY_KEY_ID = originalEnv.keyId;
  if (originalEnv.keySecret === undefined)
    delete process.env.RAZORPAY_KEY_SECRET;
  else process.env.RAZORPAY_KEY_SECRET = originalEnv.keySecret;
  vi.unstubAllGlobals();
});

describe('rupeesToPaise', () => {
  it('converts INR amounts without floating point rounding', () => {
    expect(rupeesToPaise(49)).toBe(4900);
    expect(rupeesToPaise(49.5)).toBe(4950);
    expect(rupeesToPaise(49.99)).toBe(4999);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.99, 2.345])(
    'rejects invalid amount %s',
    (amount) => {
      expect(() => rupeesToPaise(amount)).toThrow();
    }
  );
});

describe('verifyRazorpayWebhookSignature', () => {
  it('validates the raw payload using HMAC-SHA256', () => {
    const body = '{"event":"payment_link.paid"}';
    const signature = crypto
      .createHmac('sha256', 'webhook-secret')
      .update(body)
      .digest('hex');
    expect(
      verifyRazorpayWebhookSignature(body, signature, 'webhook-secret')
    ).toBe(true);
    expect(
      verifyRazorpayWebhookSignature(body + ' ', signature, 'webhook-secret')
    ).toBe(false);
  });

  it('fails closed for missing secrets, missing signatures, and malformed signatures', () => {
    expect(verifyRazorpayWebhookSignature('{}', null, 'secret')).toBe(false);
    expect(verifyRazorpayWebhookSignature('{}', 'bad', 'secret')).toBe(false);
    expect(
      verifyRazorpayWebhookSignature('{}', 'a'.repeat(64), undefined)
    ).toBe(false);
  });
});

describe('createRazorpayPaymentLink', () => {
  it('creates an INR payment link with run-scoped metadata using API credentials', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_id';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: `Basic ${Buffer.from('rzp_test_id:rzp_test_secret').toString('base64')}`,
        });
        const payload = JSON.parse(String(init?.body));
        expect(payload).toMatchObject({
          amount: 4900,
          currency: 'INR',
          accept_partial: false,
          description: 'Consultation',
          notes: {
            wacrm_flow_run_id: 'run-1',
            wacrm_node_key: 'pay_15_min',
          },
        });
        return Response.json({
          id: 'plink_test',
          short_url: 'https://rzp.io/test',
        });
      }
    );

    await createRazorpayPaymentLink(
      {
        amount: 49,
        description: 'Consultation',
        flowRunId: 'run-1',
        nodeKey: 'pay_15_min',
      },
      fetcher as typeof fetch
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://api.razorpay.com/v1/payment_links'
    );
  });

  it('does not make a request when API credentials are missing', async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const fetcher = vi.fn();
    await expect(
      createRazorpayPaymentLink(
        {
          amount: 49,
          description: 'Consultation',
          flowRunId: 'run-1',
          nodeKey: 'pay_15_min',
        },
        fetcher as typeof fetch
      )
    ).rejects.toThrow('Razorpay API credentials are not configured.');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
