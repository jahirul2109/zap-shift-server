const fs = require('fs');
const key = fs.readFileSync('./zap-shift-firebase-adminsdk.json');
const base64 = Buffer.from(key).toString('base64');