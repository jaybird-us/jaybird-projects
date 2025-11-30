/**
 * Stripe integration for jayBird Projects
 *
 * Simplified single-plan model:
 * - Free tier (no payment)
 * - Pro: $9/mo with 14-day free trial, all features included
 */

import Stripe from 'stripe';

// Initialize Stripe with secret key from environment
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Single price ID - Pro plan with 14-day trial at $9/mo
export const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1SZ08dJeyZUKWlEyaAiGwMCv';

// Plan features
export const PLAN_FEATURES = {
  free: {
    maxTrackedIssues: 25,
    baseline: false,
    varianceReports: false,
    customHolidays: false,
    description: 'Free - up to 25 tracked issues'
  },
  pro: {
    maxTrackedIssues: Infinity,
    baseline: true,
    varianceReports: true,
    customHolidays: true,
    description: 'Pro - unlimited issues, all features'
  }
};

/**
 * Create a Stripe Checkout session for subscription
 * Includes 14-day free trial automatically (configured on the price)
 */
export async function createCheckoutSession({ installationId, successUrl, cancelUrl, customerEmail }) {
  const sessionConfig = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: PRICE_ID,
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      installationId: String(installationId)
    },
    subscription_data: {
      metadata: {
        installationId: String(installationId)
      }
    }
  };

  // Pre-fill email if available
  if (customerEmail) {
    sessionConfig.customer_email = customerEmail;
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);
  return session;
}

/**
 * Create a billing portal session for managing subscription
 */
export async function createPortalSession({ customerId, returnUrl }) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  });

  return session;
}

/**
 * Get subscription status for an installation
 * Returns plan, status, trial info, and period end date
 */
export async function getSubscriptionStatus(customerId) {
  if (!customerId) {
    return {
      plan: 'free',
      status: 'active',
      trial: false,
      trialEnd: null
    };
  }

  // Check for any subscriptions (active, trialing, or past_due)
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    limit: 1,
    expand: ['data.default_payment_method']
  });

  if (subscriptions.data.length === 0) {
    return {
      plan: 'free',
      status: 'active',
      trial: false,
      trialEnd: null
    };
  }

  const subscription = subscriptions.data[0];
  const isTrialing = subscription.status === 'trialing';
  const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;

  return {
    plan: 'pro',
    status: subscription.status,
    trial: isTrialing,
    trialEnd,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    subscriptionId: subscription.id
  };
}

/**
 * Handle Stripe webhook events
 */
export async function handleWebhookEvent(event, logger) {
  const { updateInstallationSubscription } = await import('./database.js');

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const installationId = session.metadata?.installationId;
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (installationId) {
        logger.info({ installationId, customerId, subscriptionId }, 'Checkout completed');
        updateInstallationSubscription(parseInt(installationId), {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          plan: 'pro',
          subscriptionStatus: 'active'
        });
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const subscription = event.data.object;
      const installationId = subscription.metadata?.installationId;

      if (installationId) {
        const status = subscription.status;
        // Pro plan if subscription exists and is active/trialing
        const plan = ['active', 'trialing'].includes(status) ? 'pro' : 'free';

        logger.info({ installationId, plan, status }, 'Subscription updated');
        updateInstallationSubscription(parseInt(installationId), {
          plan,
          subscriptionStatus: status
        });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const installationId = subscription.metadata?.installationId;

      if (installationId) {
        logger.info({ installationId }, 'Subscription canceled');
        updateInstallationSubscription(parseInt(installationId), {
          plan: 'free',
          subscriptionStatus: 'canceled'
        });
      }
      break;
    }

    case 'customer.subscription.trial_will_end': {
      // Trial ending in 3 days - could send notification
      const subscription = event.data.object;
      const installationId = subscription.metadata?.installationId;
      logger.info({ installationId, trialEnd: subscription.trial_end }, 'Trial ending soon');
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Unhandled Stripe event');
  }
}

/**
 * Verify Stripe webhook signature
 */
export function verifyWebhookSignature(payload, signature) {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

export { stripe };
