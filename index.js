require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb')
const app = express();
const cors = require('cors');
const client = new MongoClient(`mongodb+srv://${process.env.USER_ID}:${process.env.USER_PASS}@cluster0.b6s1ev2.mongodb.net/?appName=Cluster0`);
const stripe = require('stripe')(process.env.PAYMENT_KEY);
const { initializeApp, cert } = require("firebase-admin");
const { getAuth } = require("firebase-admin/auth");
// const port = process.env.PORT || 3000;

// middleware
app.use(cors())
app.use(express.json());
const decodedFirebaseKey = Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64").toString('utf8');
const serviceAccount = JSON.parse(decodedFirebaseKey);

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

let trackingCollection
let parcelCollection;
let riderCollection;
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
        riderCollection = db.collection("riders")
        trackingCollection = db.collection("trackings")

        await paymentCollection.createIndex({
            paymentIntent: 1
        },
            {
                unique: true
            }
        )
        await trackingCollection.createIndex({
            trackingId: 1,
            status: 1
        },
            {
                unique: true
            })

    } catch (err) {
        console.dir(err);
    }
}

const trackingLogs = async (trackingId, status) => {
    try {
        await trackingCollection.insertOne({
            trackingId,
            status,
            statusDetails: status.split("_").join(" "),
            createAt: new Date(),
        });
    } catch (error) {

        if (error.code === 11000) {
            console.log(`Duplicate tracking status: ${status}`);
            return;
        }

        throw error;
    }
};

// Verification
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
// Admin verification
const adminVerification = async (req, res, next) => {
    const email = req.decodeEmail;
    const query = { email }
    const user = await userCollection.findOne(query);
    if (!user) {
        return res.status(404).send({
            message: "User not found"
        })
    }
    if (user.role !== "admin") {
        console.log("forbidden access (role)")
        return res.status(403).send({
            message: "forbidden access (role)"
        })
    }
    next();

}
// connect db for operation
app.use(async (req, res, next) => {
    try {
        await connectToMongoDB();
        next();
    } catch (error) {
        console.log(error.message);
        res.status(500).send({
            message: "Database connection failed"
        });
    }
})

// Track Id to check Delivery Status 
app.get('/trackId/:id/status', async (req, res) => {
    try {
        const query = { trackingId: req.params.id };
        const result = await trackingCollection.find(query).sort({ createAt: 1 }).toArray();
        res.send(result);
    }
    catch (error) {
        console.log(error.message)
        res.status(500).send({
            message: "Server Error"
        })
    }
})


// User
app.post('/users', firebaseVerificatoin, async (req, res) => {
    try {
        const newUser = req.body;
        const email = newUser.email;
        if (email !== req.decodeEmail) {
            return res.status(403).send({
                message: "Forbidden accss"
            })
        }
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

app.get('/users', firebaseVerificatoin, async (req, res) => {
    try {
        const result = await userCollection.find().toArray();
        res.send(result)
    }
    catch (err) {
        res.status(500).send({
            message: "Server Error"
        })
    }
})

app.get('/users/:email/role', firebaseVerificatoin, async (req, res) => {
    try {
        const email = req.params.email;
        if (email !== req.decodeEmail) {
            return res.status(403).send({
                message: "forbidden access"
            })
        }
        const query = { email };
        const result = await userCollection.findOne(query);
        res.send(result)
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }
})

app.patch('/users/:id', firebaseVerificatoin, adminVerification, async (req, res) => {
    try {
        const id = req.params.id;
        const { role } = req.body
        const query = { _id: new ObjectId(id) }
        const updateInfo = {
            $set: {
                role: role
            }
        }
        const result = await userCollection.updateOne(query, updateInfo);
        res.send(result)
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }
})

app.get("/user-stats/:email", firebaseVerificatoin, async (req, res) => {
    const email = req.params.email;
    if (email !== req.decodeEmail) {
        return res.status(403).send({
            message: "forbidden access"
        })
    }
    try {
        const result = await parcelCollection.aggregate([
            {
                $match: {
                    senderEmail: req.decodeEmail,
                    payment: "paid",
                }
            },
            {
                $facet: {
                    total: [
                        {
                            $group: {
                                _id: null,
                                count: {
                                    $sum: 1
                                },
                                totalCost: {
                                    $sum: "$cost"
                                }
                            }
                        }
                    ],
                    status: [
                        {
                            $group: {
                                _id: "$deliveryStatus",
                                count: {
                                    $sum: 1
                                },
                                totalCost: {
                                    $sum: "$cost"
                                }
                            }
                        }
                    ]
                }
            }
        ]).toArray();
        res.send(result)
    }

    catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
})

app.get('/admin-stats/:email', firebaseVerificatoin, async (req, res) => {
    try {
        const email = req.params.email;
        if (email !== req.decodeEmail) {
            return res.status(403).send({
                message: "forbidden access"
            })
        }
        const result = await parcelCollection.aggregate([
            {
                $match: {
                    payment: "paid"
                }
            }, {
                $group: {
                    _id: "$deliveryStatus",
                    count: { $sum: 1 },
                    cost: {
                        $sum: "$cost"
                    }
                }
            }
        ]).toArray();
        res.send(result)
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }
})

// riders 
app.post('/riders', firebaseVerificatoin, async (req, res) => {
    try {
        const rider = req.body;
        const email = rider.email;
        if (email !== req.decodeEmail) {
            return res.status(401).send({
                message: "Fobidden access"
            })
        }
        rider.status = "pending"
        rider.creatAt = new Date();
        const riderExist = await riderCollection.findOne({ email: email });
        if (riderExist) {
            return res.status(409).send({
                message: "riders already exist"
            })
        }
        const result = await riderCollection.insertOne(rider);
        res.send(result)
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }

})

app.get("/riders", firebaseVerificatoin, adminVerification, async (req, res) => {
    const { workStatus, district } = req.query;
    const query = {}
    if (workStatus) {
        query.workStatus = workStatus
    }
    if (district) {
        query.district = district
    }
    const result = await riderCollection.find(query).toArray();
    res.send(result)
})

app.patch("/riders/:id", firebaseVerificatoin, adminVerification, async (req, res) => {
    const { status, email } = req.body;
    const id = req.params.id;
    const cursor = { _id: new ObjectId(id) };
    const update = {
        $set: {
            status: status
        }
    }
    if (status === "apprroved") {
        update.$set.workStatus = "available"
    }
    if (status === "rejected") {
        update.$set.workStatus = "unavailable"
    }
    const result = await riderCollection.updateOne(cursor, update);
    const query = { email };
    const updateUser = {
        $set: {
            role: "rider"
        }
    }
    if (status === "apprroved") {
        const updateRole = await userCollection.updateOne(query, updateUser);
    }
    res.send(result)
})

app.delete("/riders/:id", firebaseVerificatoin, adminVerification, async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await riderCollection.deleteOne(query);
        res.send(result);
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }
})

app.get('/rider-stats/:email', firebaseVerificatoin, async (req, res) => {
    try {
        const email = req.params.email;
        if (email !== req.decodeEmail) {
            return res.status(403).send({
                message: "forbidden access"
            })
        }
        const result = await parcelCollection.aggregate([
            {
                $match: {
                    riderEmail: req.decodeEmail,
                    deliveryStatus: {
                        $in: [
                            "delivered",
                            "pending_pickup"
                        ]
                    }
                }
            }, {
                $group: {
                    _id: "$deliveryStatus",
                    count: { $sum: 1 },
                    cost: {
                        $sum: "$cost"
                    }
                }
            }
        ]).toArray();
        res.send(result)
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }
})


// Parcels
app.post('/parcels', firebaseVerificatoin, async (req, res) => {
    try {
        const data = req.body;
        if (req.decodeEmail !== data.senderEmail) {
            return res.status(403).send({
                message: "Forbidden access"
            })
        }
        const trackId = generateTrackingId();
        data.createAt = new Date();
        data.trackingId = trackId;
        await trackingLogs(trackId, "parcel_created")
        const result = await parcelCollection.insertOne(data);
        res.send(result)
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }
})
// get rider for rider order
app.get('/parcels/:ridermail/rider', firebaseVerificatoin, async (req, res) => {
    try {
        const email = req.params.ridermail;
        if (email !== req.decodeEmail) {
            return res.status(403).send({
                message: "forbidden access"
            })
        }
        const query = {
            riderEmail: email,
            deliveryStatus: {
                $nin: [
                    "delivered",
                    "cancelled"
                ]
            }
        };

        const result = await parcelCollection.find(query).toArray();
        res.send(result);
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }
})
app.get('/parcels/:ridermail/riderOrder', firebaseVerificatoin, async (req, res) => {
    try {
        const email = req.params.ridermail;
        const { limit } = req.query;
        if (email !== req.decodeEmail) {
            return res.status(403).send({
                message: "forbidden access"
            })
        }
        const query = {
            riderEmail: email,
        };

        const result = await parcelCollection.find(query).limit(Number(limit)).toArray();
        res.send(result);
    }
    catch (err) {
        console.log(err.message)
        return res.status(500).send({
            message: "Server Error"
        })
    }
})
// admin get 
app.get('/parcels/admin', firebaseVerificatoin , adminVerification, async (req, res) => {
    try {
        const { deliveryStatus } = req.query;
        const query = {
            payment: "paid"
        };
        if (deliveryStatus) {
            query.deliveryStatus = deliveryStatus
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
// user  get
app.get('/parcels/user', firebaseVerificatoin, async (req, res) => {
    try {
        const query = {};
        const { email, deliveryStatus } = req.query;
        if (email !== req.decodeEmail) {
            return res.status(403).send({
                message: "Forbidden access"
            })
        }
        if (email) {
            query.senderEmail = email;
        }
        if (deliveryStatus) {
            query.deliveryStatus = deliveryStatus;
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
// app.get("/parcel/:id", async (req, res) => {
//     try {
//         const id = { _id: ObjectId(req.params.id) };
//         const result = await parcelCollection.findOne(id)
//         res.send(result)
//     }
//     catch (err) {
//         console.log(err.message)
//         res.status(500).json({
//             success: false,
//             message: err.message
//         })
//     }
// })
app.delete("/parcels/:id", firebaseVerificatoin, async (req, res) => {
    try {
        const id = req.params.id;
        const cursor = { _id: new ObjectId(id), senderEmail: req.decodeEmail };
        const result = parcelCollection.deleteOne(cursor);
        res.send(result);
    }
    catch (err) {
        console.log(err.message)
        res.status(500).json({
            success: false,
            message: err.message
        })
    }
})
app.patch("/parcels/:id/deliveryStatus", firebaseVerificatoin, async (req, res) => {
    try {
        const query = { _id: new ObjectId(req.params.id) }
        const { reasons } = req.query;
        const { deliveryStatus, trackingId, riderEmail } = req.body;
        if (req.decodeEmail !== riderEmail) {
            return res.status(403).send({
                message: "forbidden access"
            })
        }
        const updateStatus = {
            $set: {
                deliveryStatus: deliveryStatus == "cancelled" ? "pending_pickup" : deliveryStatus
            }
        }
        await trackingLogs(trackingId, deliveryStatus)
        const result = await parcelCollection.updateOne(query, updateStatus);

        if (deliveryStatus === "delivered" || deliveryStatus === "cancelled") {
            const updateWorkStatus = {
                $set: {
                    workStatus: "available"
                }
            }
            const workStatus = await riderCollection.updateOne({ email: riderEmail }, updateWorkStatus);
        }

        if (deliveryStatus === "cancelled") {
            const cancelledInfo = {
                parcelId: req.params.id,
                createAt: new Date(),
                whyCancelled: reasons
            }
            await riderCollection.updateOne({ email: riderEmail }, {
                $push: {
                    cancelled: cancelledInfo
                }
            })
        }

        res.send(result)
    }
    catch (err) {
        console.log(err.message)
        res.status(500).json({
            success: false,
            message: err.message
        })
    }
})
// only admin can assign  parcel to a rider
app.patch("/parcels/:id/assigning", firebaseVerificatoin, adminVerification, async (req, res) => {
    try {
        const query = { _id: new ObjectId(req.params.id) }
        const { riderEmail, riderName, deliveryStatus, trackingId } = req.body;
        const updateParcelInfo = {
            $set: {
                riderEmail: riderEmail,
                riderName: riderName,
                deliveryStatus: deliveryStatus
            }
        }
        await trackingLogs(trackingId, deliveryStatus)
        const result = await parcelCollection.updateOne(query, updateParcelInfo);
        const updateRiderInfo = {
            $set: {
                workStatus: "in_delivery"
            }
        }
        const resultRider = await riderCollection.updateOne({ email: riderEmail }, updateRiderInfo);
        res.send(resultRider)
    }
    catch (err) {
        console.log(err.message)
        res.status(500).json({
            success: false,
            message: err.message
        })
    }

})


// Payment Methood
// 1st one 
// app.post('/create_checkout_session', async (req, res) => {
//     try {
//         const paymentInfo = req.body;
//         const ammount = parseInt(paymentInfo.cost * 100);
//         const session = await stripe.checkout.sessions.create({
//             line_items: [
//                 {
//                     price_data: {
//                         currency: "usd",
//                         unit_amount: ammount,
//                         product_data: {
//                             name: paymentInfo.parcelName,
//                         }
//                     },
//                     quantity: 1
//                 }
//             ],
//             customer_email: paymentInfo.coustomerEmail,
//             mode: "payment",
//             metadata: {
//                 parcelId: paymentInfo.parcelId
//             },
//             success_url: `${process.env.SITE_URL}/dashboard/payment-success`,
//             cancel_url: `${process.env.SITE_URL}/dashboard/payment-cancel`
//         })
//         // console.log(session.url)
//         res.send({ url: session.url })
//     }

//     catch (error) {
//         console.log(error.message)
//         res.status(500).json({
//             message: error.message
//         })
//     }
// })
// 2nd one 
app.post('/payment_checkout_session', firebaseVerificatoin, async (req, res) => {
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
            customer_email: req.decodeEmail,
            metadata: {
                parcelId: paymentInfo.parcelId,
                parcelName: paymentInfo.parcelName,
                trackingId: paymentInfo.trackingId,
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

app.patch('/payment-verification', firebaseVerificatoin, async (req, res) => {
    try {
        const { session_id } = req.query;
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.customer_email !== req.decodeEmail) {
            return res.status(403).send({
                success: false,
                message: "Forbidden access"
            })
        }
        if (session.payment_status !== "paid") {
            return res.status(400).send({
                success: false,
                message: "Payment Not paid"
            })
        }
        const paymentIntent = session.payment_intent;
        const parcelId = session.metadata.parcelId;
        const existPaymentIentent = await paymentCollection.findOne({ paymentIntent });
        if (existPaymentIentent) {
            return res.send({
                message: "Already Exsit",
                TransactionId: paymentIntent,
                trackingId: existPaymentIentent.trackingId

            })
        }

        const trackId = session.metadata.trackingId;
        const query = { _id: new ObjectId(parcelId) };
        const update = {
            $set: {
                payment: "paid",
                trackingId: trackId,
                deliveryStatus: "pending_pickup"
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
            deliveryStatus: "pending_pickup",
            cost: session.amount_total / 100,
            paidAt: new Date()
        }
        await trackingLogs(trackId, "assigning_to_rider")
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

app.get("/payment-info", firebaseVerificatoin, async (req, res) => {
    try {
        const { email, limit } = req.query;
        const query = {};
        if (email) {
            query.customerEmail = req.decodeEmail
        };
        const result = await paymentCollection
            .find(query)
            .sort({ paidAt: - 1 })
            .limit(Number(limit))
            .toArray();
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

module.exports = app