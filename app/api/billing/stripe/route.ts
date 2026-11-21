import type Stripe from 'stripe';
import { billingStripe } from '@/lib/billing/stripe';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({error:'Billing unavailable'},{status:503});
  if (Number(request.headers.get('content-length') ?? 0)>1_000_000) return new Response(null,{status:413});
  const body=await request.text();
  if (body.length>1_000_000) return new Response(null,{status:413});
  const stripe=billingStripe();
  let event: Stripe.Event;
  try { event=stripe.webhooks.constructEvent(body,request.headers.get('stripe-signature') ?? '',secret); }
  catch { return Response.json({error:'Invalid signature'},{status:400}); }
  const admin=createSupabaseAdminClient();
  if (!admin) return new Response(null,{status:503});
  try {
    if (event.type==='checkout.session.completed') {
      const session=event.data.object;
      if (session.mode!=='subscription' || session.payment_status!=='paid' || !session.metadata?.owner_id || !session.metadata.checkout_key) return Response.json({received:true});
      const subscriptionId=typeof session.subscription==='string' ? session.subscription : session.subscription?.id;
      const customerId=typeof session.customer==='string' ? session.customer : session.customer?.id;
      if (!subscriptionId || !customerId) throw new Error('Incomplete payment');
      const subscription=await stripe.subscriptions.retrieve(subscriptionId);
      if (subscription.status!=='active') return Response.json({received:true});
      if (!subscription.items.data.some(item=>item.price.id===process.env.STRIPE_PARTNER_MONTHLY_PRICE_ID)) throw new Error('Wrong plan');
      const {error}=await admin.rpc('fulfill_partner_enrollment',{
        p_owner:session.metadata.owner_id,p_checkout_key:session.metadata.checkout_key,p_session:session.id,
        p_customer:customerId,p_subscription:subscriptionId,
      });
      if (error) throw error;
    } else if (event.type==='customer.subscription.updated' || event.type==='customer.subscription.deleted') {
      // Read current provider state, so late/out-of-order notifications cannot
      // revive a cancelled subscription or overwrite a recovered payment.
      const current=await stripe.subscriptions.retrieve(event.data.object.id);
      const status=current.status==='active' || current.status==='trialing' ? 'active' : current.status==='canceled' ? 'cancelled' : 'past_due';
      const {data: enrollment,error}=await admin.from('partner_enrollments').update({status})
        .eq('stripe_subscription_id',current.id).select('partner_id').maybeSingle();
      if(error) throw error;
      if(enrollment?.partner_id) {
        const {error:saveError}=await admin.from('partner_onboarding').update({billing_status:status}).eq('partner_id',enrollment.partner_id);
        if(saveError) throw saveError;
      }
    }
  } catch { return Response.json({error:'Billing update pending; retry delivery'},{status:503}); }
  return Response.json({received:true});
}
