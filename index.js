require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb')
const app = express();
const cors = require('cors');
const client = new MongoClient(`mongodb+srv://${process.env.USER_ID}:${process.env.USER_PASS}@cluster0.b6s1ev2.mongodb.net/?appName=Cluster0`);
const port = process.env.PORT || 3000;

// middleware
app.use(cors())
app.use(express.json());


let parcelCollection ; 
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



app.post('/parcels', async(req , res )=> {
    const data = req.body;
    const result = await parcelCollection.insertOne(data);
    res.send(result)
})

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})