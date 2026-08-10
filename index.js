require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb')
const app = express();
const cors = require('cors');
const client = new MongoClient(`mongodb+srv://${process.env.USER_ID}:${process.env.USER_PASS}@cluster0.b6s1ev2.mongodb.net/?appName=Cluster0`);
const stripe = require('stripe')(process.env.PAYMENT_KEY);
const port = process.env.PORT || 3000;

// middleware
app.use(cors())
app.use(express.json());


let parcelCollection;
let paymentCollection;
const connectToMongoDB = async () => {
    try {
        await client.connect();
        const db = client.db('zap_shift_db');
        parcelCollection = db.collection('parcels');

    } catch (err) {
        console.dir(err);
    }
}

app.use(async (req, res, next) => {
    await connectToMongoDB();
    next()
})

// Parcels

app.post('/parcels', async (req, res) => {
    const data = req.body;
    data.createAt = new Date();
    const result = await parcelCollection.insertOne(data);
    res.send(result)
})

app.get('/parcels', async (req, res) => {
    try {
        const query = {};
        const { email } = req.query;
        if (email) {
            query.senderEmail = email;
        }
        const result = await parcelCollection.find(query).toArray();
        res.send(result)
    }
    catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        })
    }
})

app.delete("/parcels/:id", async (req, res) => {
    const id = req.params.id;
    const cursor = { _id: new ObjectId(id) };
    const result = parcelCollection.deleteOne(cursor);
    res.send(result);
})


// Payment Methood
// 1st one 
app.post('/create_checkout_session', async (req, res) => {
    try {
        const paymentInfo = req.body;
        const ammount = parseInt(paymentInfo.cost * 100);
        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        unit_amount: ammount,
                        product_data: {
                            name: paymentInfo.parcelName,
                        }
                    },
                    quantity: 1
                }
            ],
            customer_email: paymentInfo.coustomerEmail,
            mode: "payment",
            metadata: {
                parcelId: paymentInfo.parcelId
            },
            success_url: `${process.env.SITE_URL}/dashboard/payment-success`,
            cancel_url: `${process.env.SITE_URL}/dashboard/payment-cancel`
        })
        // console.log(session.url)
        res.send({ url: session.url })
    }

    catch (error) {
        console.log(error.message)
        res.status(500).json({
            message: error.message
        })
    }
})
// 2nd one 
app.post('/payment_checkout_session', async (req, res) => {
    try {
        const paymentInfo = req.body;
        const ammount = parseInt(paymentInfo.cost * 100)
        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        unit_amount: ammount,
                        product_data: {
                            name: paymentInfo.parcelName
                        }
                    },
                    quantity: 1
                }
            ],
            mode: "payment",
            customer_email: paymentInfo.coustomerEmail,
            metadata: {
                parcelId: paymentInfo.parcelId
            },
            success_url: `${process.env.SITE_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.SITE_URL}/dashboard/payment-cancel`
        })
        const createAt = new Date();
        // console.log(session.url)
        res.send({ url: session.url , createAt })
    }
    catch (err) {
        console.log(err.message)
        res.status(500).json(
            { message: err.message }
        )
    }
})

app.patch('/payment-verification', async (req, res) => {
    const { session_id } = req.query;
    // console.log(session_id)
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status === "paid") {
        const parcelId = session.metadata.parcelId;
        const query = { _id: new ObjectId(parcelId) };
        const update = {
            $set: {
                payment: "paid"
            }
        }
        const result = await parcelCollection.updateOne(query, update);
        res.send({
            success: true,
            message: "Payment Status Updated"
        })
        const paymentInfo = {
            paymentIntent : session.payment_intent,
            
        }
    }
    console.log("retirve data", session)
    res.send({ success: false })
})

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})