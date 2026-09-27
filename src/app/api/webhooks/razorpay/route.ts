import {
  cancelRazorpayPaymentLink,
  getRazorpayPayment,
  getRazorpayPaymentLink,
  verifyRazorpayWebhookSignature,
} from '@/lib/flows/razorpay';
import { resumeRazorpayPayment } from '@/lib/flows/engine';

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment_link?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; payment_link_id?: string } };
  };
}

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json(
      { error: 'Webhook secret is not configured.' },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  if (
    !verifyRazorpayWebhookSignature(
      rawBody,
      request.headers.get('x-razorpay-signature'),
      webhookSecret
    )
  ) {
    return Response.json(
      { error: 'Invalid webhook signature.' },
      { status: 401 }
    );
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    return Response.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const isPaymentLinkEvent =
    body.event === 'payment_link.paid' ||
    body.event === 'payment_link.cancelled' ||
    body.event === 'payment_link.expired';
  const isFailedPaymentEvent = body.event === 'payment.failed';
  if (!isPaymentLinkEvent && !isFailedPaymentEvent) {
    return Response.json({ received: true });
  }

  try {
    const paymentLinkId = isFailedPaymentEvent
      ? body.payload?.payment?.entity?.payment_link_id
      : body.payload?.payment_link?.entity?.id;
    if (!paymentLinkId) return Response.json({ received: true });

    let link = await getRazorpayPaymentLink(paymentLinkId);
    if (link.id !== paymentLinkId) {
      return Response.json(
        { error: 'Payment link identity mismatch.' },
        { status: 502 }
      );
    }

    if (isFailedPaymentEvent) {
      const paymentId = body.payload?.payment?.entity?.id;
      if (!paymentId) return Response.json({ received: true });
      const payment = await getRazorpayPayment(paymentId);
      if (
        payment.id !== paymentId ||
        payment.payment_link_id !== link.id ||
        payment.status !== 'failed'
      ) {
        return Response.json({ received: true });
      }
      if (link.status === 'created') {
        await cancelRazorpayPaymentLink(link.id);
        link = await getRazorpayPaymentLink(link.id);
      }
    }

    const result = await resumeRazorpayPayment(link);
    if (result === 'pending') {
      return Response.json(
        { error: 'Payment link has no final status yet.' },
        { status: 503 }
      );
    }
    return Response.json({ received: true });
  } catch (error) {
    console.error(
      '[razorpay-webhook] processing failed:',
      error instanceof Error ? error.message : error
    );
    return Response.json(
      { error: 'Payment verification failed.' },
      { status: 503 }
    );
  }
}
