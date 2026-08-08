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



const connectToMongoDB = async () => {
    try {
        await client.connect();
        
    } catch (err) {
        console.dir(err);
    }
}

app.use(async (req, res, next) => {
    await connectToMongoDB();
    next()
})




app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})