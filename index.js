require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb')
const app = express();
const cors = require('cors');
const client = new MongoClient(`mongodb+srv://${process.env.USER_ID}:${process.env.USER_PASS}@cluster0.b6s1ev2.mongodb.net/?appName=Cluster0`);
const stripe = require('stripe')(process.env.PAYMENT_KEY);
const { initializeApp, cert } = require("firebase-admin");
const { getAuth } = require("firebase-admin/auth");
const port = process.env.PORT || 3000;

// middleware
app.use(cors())
app.use(express.json());

const serviceAccount = require("./zap-shift-firebase-adminsdk.json");

initializeApp({
    credential: cert(serviceAccount)
});

const generateTrackingId = () => {
    const random = Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    return `TRK-${Date.now()}-${random}`;
};

let parcelCollection;
let paymentCollection;
let userCollection;
const connectToMongoDB = async () => {
    try {
        if (userCollection) {
            console.log("already connected")
            return;
        }
        await client.connect();
        const db = client.db('zap_shift_db');
        parcelCollection = db.collection('parcels');
        paymentCollection = db.collection("paymentInfo")
        userCollection = db.collection("users")

    } catch (err) {
        console.dir(err);
    }
}

const firebaseVerificatoin = async (req, res, next) => {
    try {
        const authorization = req.headers.authorization;
        if (!authorization) {
            return res.status(401).send({
                message: "Unauthorizat Access"
            })
        }
        const token = authorization.split(" ")[1]
        const decode = await getAuth().verifyIdToken(token);
        req.decodeEmail = decode.email;
        next()
    }
    catch (err) {
        console.log(err.message)
        return res.status(401).send("unauthorizat access")
    }

}
app.use(async (req, res, next) => {
    await connectToMongoDB();
    next()
})
// user
app.post('/users', async (req, res) => {
    try {
        // console.log("heder", req.headers)
        // console.log(req.decodeEmail)
        const newUser = req.body;
        const email = newUser.email;
        newUser.creatAt = new Date();
        newUser.role = "user";
        const exsitUser = await userCollection.findOne({ email });
        if (exsitUser) {
            return res.send({
                message: "User Already Exsit"
            })
        }
        const result = await userCollection.insertOne(newUser);
        res.send(result);
    }
    catch (err) {
        console.log("user", err.message)
        res.status(500).send({
            success: false,
            message: "Server Error"
        })
    }
})

// riders 

// Parcels
app.post('/parcels', async (req, res) => {
    const data = req.body;
    data.createAt = new Date();
    const result = await parcelCollection.insertOne(data);
    res.send(result)
})

app.get('/parcels', firebaseVerificatoin, async (req, res) => {
    console.log(req.decodeEmail)
    try {
        const query = {};
        const { email } = req.query;
        if (email) {
            query.senderEmail = email;
        }
        if (email !== req.decodeEmail) {
            return res.status(403).send({
                message: "forbidden access"
            })
        }
        const result = await parcelCollection.find(query).sort({ createAt: -1 }).toArray();
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
                            name: ` Pay For ${paymentInfo.parcelName}`
                        }
                    },
                    quantity: 1
                }
            ],
            mode: "payment",
            customer_email: paymentInfo.coustomerEmail,
            metadata: {
                parcelId: paymentInfo.parcelId,
                parcelName: paymentInfo.parcelName
            },
            success_url: `${process.env.SITE_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.SITE_URL}/dashboard/payment-cancel`
        })
        const createAt = new Date();
        // console.log(session.url)
        res.send({ url: session.url, createAt })
    }
    catch (err) {
        console.log(err.message)
        res.status(500).json(
            { message: err.message }
        )
    }
})

app.patch('/payment-verification', async (req, res) => {
    try {
        const { session_id } = req.query;
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status !== "paid") {
            res.status(400).send({
                success: true,
                message: "Payment Not paid"
            })
        }
        const paymentIntent = session.payment_intent;
        const trackId = generateTrackingId();
        const parcelId = session.metadata.parcelId;
        const existPaymentIentent = await paymentCollection.findOne({ paymentIntent });
        if (existPaymentIentent) {
            return res.send({
                message: "Already Exsit",
                TransactionId: paymentIntent,
                trackingId: existPaymentIentent.trackingId

            })
        }
        const query = { _id: new ObjectId(parcelId) };
        const update = {
            $set: {
                payment: "paid",
                trackingId: trackId
            }
        }
        const result = await parcelCollection.updateOne(query, update);
        const paymentInfo = {
            paymentIntent: paymentIntent,
            trackingId: trackId,
            parcelId: session.metadata.parcelId,
            parcelName: session.metadata.parcelName,
            customerEmail: session.customer_email,
            currency: session.currency,
            cost: session.amount_total / 100,
            paidAt: new Date()
        }
        const resultPayment = await paymentCollection.insertOne(paymentInfo)
        res.send({
            success: true,
            message: "Payment Verification Successfully",
            resultPayment: resultPayment,
            result: result,
            trackingId: trackId,
            TransactionId: session.payment_intent,
            parcelId: parcelId,
        })
    }
    catch (err) {
        console.log(err.message)
        res.status(500).send({
            success: false,
            message: err.message
        })
    }
})

app.get("/payment-info", async (req, res) => {
    try {
        const { email } = req.query;
        const query = {};
        if (email) {
            query.customerEmail = email
        };
        const result = await paymentCollection.find(query).sort({ paidAt: 1 }).toArray();
        res.send(result);
    }
    catch (err) {
        console.log(err.message)
        res.status(500).send({
            success: false,
            message: "Server Error"
        })
    }
})

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})