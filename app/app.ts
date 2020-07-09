require('dotenv').config();
import express from 'express';
import { Request, Response } from 'express';
import jwtDecode from 'jwt-decode';
import { XeroClient, XeroIdToken, XeroAccessToken } from 'xero-node';
import { TokenSet } from 'openid-client';

const session = require('express-session');

const client_id: string = process.env.CLIENT_ID;
const client_secret: string = process.env.CLIENT_SECRET;
const redirectUrl: string = process.env.REDIRECT_URI;
const scopes: string = 'openid profile email accounting.settings accounting.reports.read accounting.journals.read accounting.contacts accounting.attachments accounting.transactions offline_access';

const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes.split(' '),
});

if (!client_id || !client_secret || !redirectUrl) {
  throw Error('Environment Variables not all set - please check your .env file in the project root or create one!')
}

const app: express.Application = express();

app.use(express.static(__dirname + '/build'));

app.use(session({
  secret: 'something crazy',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false },
}));

app.get('/', async (req: Request, res: Response) => {
  if (req.session.activeTenant) {
    try {
      // console.log('activeTenant', req.session.activeTenant);

      const response: any = await xero.accountingApi.getOrganisations(req.session.activeTenant.tenantId);
      req.session.activeTenantName = response.body.organisations[0].name;
      res.send(`<p>Connected to: ${req.session.activeTenantName}</p><p><a href='/disconnect'>Disconnect</a></p>`);
    } catch (err) {
      if (err.response.statusCode === 401) {
        res.send(`<p>Session has expired...</p><p><a href='/connect'>Reconnect ${req.session.activeTenantName}</a></p><p><a href='/disconnect'>Disconnect</a></p>`);
      } else {
        console.log('err', err);
        res.send('Sorry, something went wrong');
      }
    }
  } else {
    res.send(`<a href='/connect'>Connect to Xero</a>`);
  }
});

app.get('/disconnect', async (req: Request, res: Response) => {
  try {
    if (req.session.activeTenant) {
      console.log('disconnecting:', req.session.activeTenant.id);
      const updatedTokenSet: TokenSet = await xero.disconnect(req.session.activeTenant.id);
      await xero.updateTenants();

      // if > 1 Organisation connected, update token
      if (xero.tenants.length > 0) {
        const decodedIdToken: XeroIdToken = jwtDecode(updatedTokenSet.id_token);
        const decodedAccessToken: XeroAccessToken = jwtDecode(updatedTokenSet.access_token);
        req.session.decodedIdToken = decodedIdToken;
        req.session.decodedAccessToken = decodedAccessToken;
        req.session.tokenSet = updatedTokenSet;
        req.session.allTenants = xero.tenants;
        req.session.activeTenant = xero.tenants[0];
      } else {
        req.session.decodedIdToken = undefined;
        req.session.decodedAccessToken = undefined;
        req.session.allTenants = undefined;
        req.session.activeTenant = undefined;
      }
      req.session.activeTenantName = undefined;
      res.redirect('/');
    } else {
      res.redirect('/');
    }
  } catch (err) {
    res.send('Sorry, something went wrong');
  }
});

app.get('/connect', async (req: Request, res: Response) => {
  try {
    const consentUrl: string = await xero.buildConsentUrl();
    res.redirect(consentUrl);
  } catch (err) {
    res.send('Sorry, something went wrong');
  }
});

app.get('/callback', async (req: Request, res: Response) => {
  try {
    const accessToken: TokenSet = await xero.apiCallback(req.url);
    await xero.updateTenants();

    if (accessToken.id_token) {
      const decodedIdToken: XeroIdToken = jwtDecode(accessToken.id_token);
      req.session.decodedIdToken = decodedIdToken;
    }
    const decodedAccessToken: XeroAccessToken = jwtDecode(accessToken.access_token);

    req.session.decodedAccessToken = decodedAccessToken;
    req.session.accessToken = accessToken;
    req.session.allTenants = xero.tenants;
    req.session.activeTenant = xero.tenants[0];

    res.redirect('/');
  } catch (err) {
    res.send(`Sorry, something went wrong: ${JSON.stringify(err)}`);
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
