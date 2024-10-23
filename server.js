import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import storeganiseApi from './storeganise-api.js';
import yourIntegrationApi from './your-integration-api.js';
import handler from './handler.js';

if (!process.env.SG_API_KEY) throw new Error('Missing required apiKey env var');
if (!process.env.SG_SIGNATURE_SECRET) throw new Error('Missing required signature env var');

const app = express();
app.use(express.json());

app.post('/', async (req, res) => {
  // Verify request's signature, to ensure it comes from Storeganise
  if (req.get('sg-signature') !== crypto.createHmac('sha256', process.env.SG_SIGNATURE_SECRET).update(JSON.stringify(req.body)).digest('base64')) {
    return res.status(401).send();
  }

  let storeganise;
  const {
    id, // request identifier, can be used for idempotency
    type: event, // The event type, e.g. `user.created`, `job.unit_moveIn.completed`
    data, // The event data; contains IDs depending on the event type, e.g. `userId`, `jobId`, `unitRentalId`, `invoiceId`, ..
    apiUrl, // Your storeganise account api URL
    addonId, // The enabled Addon ID at the origin of this request
  } = req.body;

  try {
    storeganise = storeganiseApi({ apiUrl, addonId });
    const addon = await storeganise.get(`addons/${addonId}`);
    const yourIntegration = yourIntegrationApi(addon); 

    const content = await handler({ storeganise, yourIntegration, event, data, addon });
    res.status(200).send(content);
  } catch (err) {
    console.error(err);

    await storeganise.post('jobs', {
      type: 'task',
      ownerId: null,
      data: {
        targetType: 'addon',
        targetId: addonId,
        title: 'Errors in your integration sync',
        desc: err.message,
      },
    })
      .catch(err => console.error('SG_IMPORTANT', err));

    res.status(err.status || 400).json({ message: err.message });
  }
});

const server = await app.listen(process.env.PORT || 3000);
console.log(`Listening on port ${server.address().port}`);
