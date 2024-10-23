import os from 'os';
import fs from 'fs';
import crypto from 'crypto';


const uuid_regex = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;

const salto_authUrls = {
  production: 'https://identity.my-clay.com/connect/token',
  testing: 'https://clp-accept-identityserver.my-clay.com/connect/token',
};

const salto_apiUrls = {
  production: 'https://connect.my-clay.com/v1.1',
  testing: 'https://clp-accept-user.my-clay.com/v1.1'
};

const salto_clientKeys = {
  production: process.env.CLIENT_ID_PRODUCTION + ':' + process.env.CLIENT_SECRET_PRODUCTION,
  testing: process.env.CLIENT_ID_TESTING + ':' + process.env.CLIENT_SECRET_TESTING,
};


function getSaltoCacheName(addon) {
  const credentialsHash = crypto.createHash('md5').update(addon.customFields.salto_admin_username + ':' + addon.customFields.salto_admin_password).digest('hex');
  return os.tmpdir() + `/.salto.access_token.${credentialsHash}`;
}

async function getAccessToken(addon) {
  const accessToken = await fs.promises.readFile(getSaltoCacheName(addon), 'utf8').catch(() => '');
  if (accessToken) return accessToken;

  const username = addon.customFields.salto_admin_username;
  const password = addon.customFields.salto_admin_password;

  const auth = await fetch(salto_authUrls[addon.customFields.salto_environment || 'production'], {
    method: 'POST',
    body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&scope=user_api.full_access`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(salto_clientKeys[addon.customFields.salto_environment || 'production']).toString('base64')}` 
    }
  }).then(r => r.json());

  if (!auth.access_token) throw Object.assign(new Error('invalid auth'), auth);
  await fs.promises.writeFile(getSaltoCacheName(addon), auth.access_token);
  console.log('saved new salto access_token');
  return auth.access_token;
}


export default async function createSession(addon) {
  let accessToken;
  const saltoSiteSid = addon.customFields.salto_siteId?.match(/[A-Z0-9]+/)?.[0];
  let saltoSiteId = addon.customFields.salto_siteId?.match(uuid_regex)?.[0];

  if (!saltoSiteId) {
    saltoSiteId = (await fetchSalto(`/sites?$filter=site_uid eq '${saltoSiteSid}'`)).items[0]?.id;
    // Here let's maybe set the apiKey as manager for some time and automatically replace saltoSiteId with uuid for efficiency
  }

  async function fetchSalto(path, { method = 'GET', body, attempt = 0 } = {}) {
    if (!accessToken) accessToken = await getAccessToken(addon);
    if (process.env.DEBUG) console.log('fetchSalto', method, path, attempt);
    return fetch(`${salto_apiUrls[addon.customFields.salto_environment || 'production']}${path.startsWith('/') ? path : `/sites/${saltoSiteId}/${path}`}`, {
      method,
      headers: {
        'authorization': `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'CLP-disable-odata-v3-conversion': true,
      },
      body: body && JSON.stringify(body),
    })
      .then(async r => {
        if (r.status === 401 && attempt < 1) {
          await fs.promises.unlink(getSaltoCacheName(addon));
          return fetchSalto(path, { attempt: attempt + 1, method, body });
        }
      
        const text = await r.text();
        if (!r.ok) {
          console.log('Error ', method, path, r.status, text);
          throw Object.assign(new Error(text), { status: r.status, method, path });
        }
        try {
          return JSON.parse(text);
        } catch { 
          return text; // sometimes (for pincode endpoint) response is plain text
        }
      });
  }

  // save additional props on fetchSalto for convenience
  fetchSalto.defaultAccessGroup = addon.customFields.salto_defaultAccessGroup;
  fetchSalto.useEmail = addon.customFields.salto_useEmail;

  return fetchSalto;
}