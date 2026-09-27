import crypto from 'node:crypto';

const API_BASE = 'https://api.razorpay.com/v1';

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  status: 'created' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
  amount: number;
  amount_paid: number;
  currency: string;
  notes: Record<string, string>;
}

export interface RazorpayPayment {
  id: string;
  status: string;
  payment_link_id: string | null;
}

export function rupeesToPaise(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be a positive INR amount.');
  }
  const [whole, fraction = ''] = String(amount).split('.');
  if (fraction.length > 2) {
    throw new Error('Payment amount cannot have more than two decimal places.');
  }
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise < 100) {
    throw new Error('Payment amount must be at least INR 1.00.');
  }
  return paise;
}

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret = process.env.RAZORPAY_WEBHOOK_SECRET
): boolean {
  if (!secret || !signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}

function authorizationHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('Razorpay API credentials are not configured.');
  }
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

async function requestRazorpay<T>(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch
): Promise<T> {
  const response = await fetcher(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authorizationHeader(),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Razorpay API request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function createRazorpayPaymentLink(
  args: {
    amount: number;
    description: string;
    flowRunId: string;
    nodeKey: string;
  },
  fetcher: typeof fetch = fetch
): Promise<RazorpayPaymentLink> {
  return requestRazorpay<RazorpayPaymentLink>(
    '/payment_links',
    {
      method: 'POST',
      body: JSON.stringify({
        amount: rupeesToPaise(args.amount),
        currency: 'INR',
        accept_partial: false,
        description: args.description,
        reference_id: crypto.randomUUID(),
        notes: {
          wacrm_flow_run_id: args.flowRunId,
          wacrm_node_key: args.nodeKey,
        },
        notify: { sms: false, email: false },
        reminder_enable: false,
      }),
    },
    fetcher
  );
}

export function getRazorpayPaymentLink(
  paymentLinkId: string,
  fetcher: typeof fetch = fetch
): Promise<RazorpayPaymentLink> {
  return requestRazorpay<RazorpayPaymentLink>(
    `/payment_links/${encodeURIComponent(paymentLinkId)}`,
    {},
    fetcher
  );
}

export function getRazorpayPayment(
  paymentId: string,
  fetcher: typeof fetch = fetch
): Promise<RazorpayPayment> {
  return requestRazorpay<RazorpayPayment>(
    `/payments/${encodeURIComponent(paymentId)}`,
    {},
    fetcher
  );
}

export function cancelRazorpayPaymentLink(
  paymentLinkId: string,
  fetcher: typeof fetch = fetch
): Promise<RazorpayPaymentLink> {
  return requestRazorpay<RazorpayPaymentLink>(
    `/payment_links/${encodeURIComponent(paymentLinkId)}/cancel`,
    { method: 'POST' },
    fetcher
  );
}
