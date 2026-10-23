// Run once after deploying, to tell Safaricom where to send Paybill payment confirmations.
require('dotenv').config();
require('../daraja').registerC2B().then(r => console.log(r)).catch(e => { console.error(e.message); process.exit(1); });
