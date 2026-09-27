import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  verifySignature: vi.fn(),
  getPaymentLink: vi.fn(),
  getPayment: vi.fn(),
  cancelPaymentLink: vi.fn(),
  resumePayment: vi.fn(),
}));

vi.mock('@/lib/flows/razorpay', () => ({
  verifyRazorpayWebhookSignature: (...args: unknown[]) =>
    h.verifySignature(...args),
  getRazorpayPaymentLink: (...args: unknown[]) => h.getPaymentLink(...args),
  getRazorpayPayment: (...args: unknown[]) => h.getPayment(...args),
  cancelRazorpayPaymentLink: (...args: unknown[]) =>
    h.cancelPaymentLink(...args),
}));

vi.mock('@/lib/flows/engine', () => ({
  resumeRazorpayPayment: (...args: unknown[]) => h.resumePayment(...args),
}));

import { POST } from './route';

function link(status: 'created' | 'paid' | 'cancelled' | 'expired') {
  return {
    id: 'plink_test',
    short_url: 'https://rzp.io/test',
    status,
    amount: 4900,
    amount_paid: status === 'paid' ? 4900 : 0,
    currency: 'INR',
    notes: { wacrm_flow_run_id: 'run-1', wacrm_node_key: 'pay_15_min' },
  };
}

function post(body: string) {
  return POST(
    new Request('https://crm.example.test/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'signed' },
      body,
    })
  );
}

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
  h.verifySignature.mockReset().mockReturnValue(true);
  h.getPaymentLink.mockReset().mockResolvedValue(link('paid'));
  h.getPayment.mockReset();
  h.cancelPaymentLink.mockReset().mockResolvedValue(link('cancelled'));
  h.resumePayment.mockReset().mockResolvedValue('advanced');
});

describe('Razorpay webhook route', () => {
  it('rejects invalid signatures before parsing or querying Razorpay', async () => {
    h.verifySignature.mockReturnValue(false);
    const response = await post('{"event":"payment_link.paid"}');

    expect(response.status).toBe(401);
    expect(h.getPaymentLink).not.toHaveBeenCalled();
    expect(h.resumePayment).not.toHaveBeenCalled();
  });

  it('uses the server-fetched paid link to continue the flow', async () => {
    const body = JSON.stringify({
      event: 'payment_link.paid',
      payload: { payment_link: { entity: { id: 'plink_test' } } },
    });
    const response = await post(body);

    expect(response.status).toBe(200);
    expect(h.verifySignature).toHaveBeenCalledWith(
      body,
      'signed',
      'test-webhook-secret'
    );
    expect(h.getPaymentLink).toHaveBeenCalledWith('plink_test');
    expect(h.resumePayment).toHaveBeenCalledWith(link('paid'));
  });

  it('verifies a failed payment and cancels its link before entering failure', async () => {
    h.getPaymentLink
      .mockResolvedValueOnce(link('created'))
      .mockResolvedValueOnce(link('cancelled'));
    h.getPayment.mockResolvedValue({
      id: 'pay_test',
      status: 'failed',
      payment_link_id: 'plink_test',
    });
    const response = await post(
      JSON.stringify({
        event: 'payment.failed',
        payload: {
          payment: {
            entity: { id: 'pay_test', payment_link_id: 'plink_test' },
          },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(h.getPayment).toHaveBeenCalledWith('pay_test');
    expect(h.cancelPaymentLink).toHaveBeenCalledWith('plink_test');
    expect(h.getPaymentLink).toHaveBeenCalledTimes(2);
    expect(h.resumePayment).toHaveBeenCalledWith(link('cancelled'));
  });

  it('returns a retryable error while Razorpay still reports a pending link', async () => {
    h.getPaymentLink.mockResolvedValue(link('created'));
    h.resumePayment.mockResolvedValue('pending');
    const response = await post(
      JSON.stringify({
        event: 'payment_link.paid',
        payload: { payment_link: { entity: { id: 'plink_test' } } },
      })
    );

    expect(response.status).toBe(503);
    expect(h.resumePayment).toHaveBeenCalledOnce();
  });

  it('returns a retryable response when Razorpay verification fails', async () => {
    h.getPaymentLink.mockRejectedValue(new Error('network unavailable'));
    const response = await post(
      JSON.stringify({
        event: 'payment_link.paid',
        payload: { payment_link: { entity: { id: 'plink_test' } } },
      })
    );

    expect(response.status).toBe(503);
    expect(h.resumePayment).not.toHaveBeenCalled();
  });
});
