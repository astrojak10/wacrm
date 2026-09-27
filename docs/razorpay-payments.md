# Razorpay Payments in Flows

The `Razorpay payment` flow node creates a separate INR Payment Link for each attempt. Its link metadata ties the signed Razorpay webhook to the flow run and node, while the active link ID is stored on the run row; the runner waits there until the server fetches the link from Razorpay and verifies its final status.

## Configuration

Set these server-only environment variables. Use a matching Razorpay **Test Mode** API key pair and a webhook secret created for the Test Mode webhook. Do not expose them through `NEXT_PUBLIC_*` variables or commit them.

```dotenv
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

In the Razorpay Dashboard's Test Mode, register `https://<your-public-host>/api/webhooks/razorpay` and subscribe to `payment_link.paid`, `payment_link.cancelled`, `payment_link.expired`, and `payment.failed`. Configure the webhook secret independently from the API key secret. Razorpay requires a public webhook endpoint; use a test/staging host or a supported tunnel rather than localhost.

Apply migration `044_razorpay_flow_node.sql` before saving flows containing the new node.

## Flow1

Replace the fixed Razorpay URL button on `pay_15_min` with a `Razorpay payment` node. Set its amount to `49`, keep the customer-facing payment message/button text, route `After verified payment` to the existing consultation scheduling step, and route `After failed or cancelled payment` to an appropriate retry/help step. The existing `send_message` URL-button behavior is unchanged for other links.

Payment-link creation failures end the run as failed and are recorded in flow events. `payment.failed` is independently fetched and validated; the link is cancelled and fetched again before the failure branch is taken, preventing a subsequent retry from being mistaken for a final failure. Replayed webhooks are acknowledged but cannot advance an already-moved run. Transient API failures return `503` so Razorpay retries delivery. Invalid signatures are rejected, and amount/currency mismatches are logged without advancing either branch.
