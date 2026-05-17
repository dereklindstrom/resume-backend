const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripe = require("stripe")("YOUR_STRIPE_SECRET_TEST_KEY_HERE"); // 👈 Paste your sk_test_... key here
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// 🚀 FUNCTION 1: Create the Checkout Page
exports.createStripeCheckout = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { priceId, userId, successUrl, cancelUrl } = req.body;

      if (!priceId || !userId) {
        return res.status(400).send({ error: "Missing required parameters." });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        allow_promotion_codes: true, // 👈 Ensures the discount box is visible!
        line_items: [
          {
            price: priceId, // The ID from your Stripe Dashboard (e.g., price_12345)
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId, // We pass the UID here so Stripe remembers who bought it
      });

      res.status(200).send({ url: session.url });
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).send({ error: error.message });
    }
  });
});

// 🚀 FUNCTION 2: The Webhook (Listens for successful payments)
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const event = req.body;

  // We only care if the checkout was completed successfully
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    
    // Remember that client_reference_id we passed in Function 1? Here it is!
    const userId = session.client_reference_id; 

    if (userId) {
      try {
        // Upgrade the user in Firestore!
        await db.collection("users").doc(userId).set({
          isPremium: true,
          subscriptionDate: admin.firestore.FieldValue.serverTimestamp(),
          stripeSessionId: session.id
        }, { merge: true });
        
        console.log(`Successfully upgraded user: ${userId}`);
      } catch (error) {
        console.error("Error updating user in Firestore:", error);
      }
    }
  }

  // Always return a 200 so Stripe knows we got the message
  res.status(200).send("Webhook received");
});