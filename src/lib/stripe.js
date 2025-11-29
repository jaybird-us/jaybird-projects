/**
 * Stripe integration for jayBird Projects
 */

import Stripe from 'stripe';

// Initialize Stripe with secret key from environment
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Price IDs from Stripe (test mode)
export const PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO || 'price_1SYvesJeyZUKWlEySEAqxipB',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_1SYvifJeyZUKWlEyyTlKZrox'
};

// Plan limits
export const PLAN_LIMITS = {
  free: {
    maxTrackedIssues: 50,
    baseline: false,
    varianceReports: false,
    customHolidays: false
  },
  pro: {
    maxTrackedIssues: Infinity,
    baseline: true,
    varianceReports: true,
    customHolidays: true
  },
  enterprise: {
    maxTrackedIssues: Infinity,
    baseline: true,
    varianceReports: true,
    customHolidays: true,
    multipleProjects: true,
    apiAccess: true,
    auditLogs: true,
    sso: true
  }
};

/**
 * Create a Stripe Checkout session for subscription
 */
export async function createCheckoutSession({ installationId, priceId, successUrl, cancelUrl }) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
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
  });

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
 */
export async function getSubscriptionStatus(customerId) {
  if (!customerId) {
    return { plan: 'free', status: 'active' };
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 1
  });

  if (subscriptions.data.length === 0) {
    return { plan: 'free', status: 'active' };
  }

  const subscription = subscriptions.data[0];
  const priceId = subscription.items.data[0]?.price.id;

  let plan = 'free';
  if (priceId === PRICE_IDS.pro) {
    plan = 'pro';
  } else if (priceId === PRICE_IDS.enterprise) {
    plan = 'enterprise';
  }

  return {
    plan,
    status: subscription.status,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end
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
          plan: 'pro' // Will be updated by subscription.updated event
        });
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const subscription = event.data.object;
      const installationId = subscription.metadata?.installationId;
      const priceId = subscription.items.data[0]?.price.id;

      let plan = 'free';
      if (priceId === PRICE_IDS.pro) {
        plan = 'pro';
      } else if (priceId === PRICE_IDS.enterprise) {
        plan = 'enterprise';
      }

      if (installationId) {
        logger.info({ installationId, plan, status: subscription.status }, 'Subscription updated');
        updateInstallationSubscription(parseInt(installationId), {
          plan,
          subscriptionStatus: subscription.status
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
