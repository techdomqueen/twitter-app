require('dotenv').config();
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const redis = require('redis');
const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.TWITTER_API_KEY;
const apiSecret = process.env.TWITTER_API_SECRET;
const callbackUrl = process.env.CALLBACK_URL || 'https://sadist-chloe.vercel.app/callback';

// Initialize Redis client
const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

// Set up session middleware with Redis
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || '7a9b3c8d2f6e1h4i9j0k5l2m8n3p7q',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true, maxAge: 24 * 60 * 60 * 1000 },
  })
);

const client = new TwitterApi({
  appKey: apiKey,
  appSecret: apiSecret,
});

app.get('/', async (req, res) => {
  try {
    const { oauth_token, oauth_token_secret, url } = await client.generateAuthLink(callbackUrl, {
      authAccessType: 'write',
    });

    req.session.oauthTokenSecret = oauth_token_secret;
    req.session.oauthToken = oauth_token;
    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
    });

    console.log('Generated auth link:', {
      sessionId: req.sessionID,
      oauth_token,
      oauth_token_secret,
      url,
    });

    res.send(`
      <html>
        <body>
          <h1>Simple Tweet App</h1>
          <p>Click to sign in with Twitter and post "hi"!</p>
          <a href="${url}"><button style="padding:10px; font-size:16px;">Sign in with Twitter</button></a>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error generating auth link:', error.message, error.data);
    res.status(500).send(`Error generating auth link: ${error.message}<br><pre>${JSON.stringify(error.data || {}, null, 2)}</pre>`);
  }
});

app.get('/callback', async (req, res) => {
  const { oauth_token, oauth_verifier } = req.query;
  const oauthTokenSecret = req.session?.oauthTokenSecret;
  const storedOauthToken = req.session?.oauthToken;

  console.log('Callback received:', {
    sessionId: req.sessionID,
    oauth_token: oauth_token || 'missing',
    oauth_verifier: oauth_verifier || 'missing',
    oauthTokenSecret: oauthTokenSecret || 'missing',
    storedOauthToken: storedOauthToken || 'missing',
  });

  if (!oauth_token || !oauth_verifier || !oauthTokenSecret || !storedOauthToken) {
    console.error('Missing OAuth parameters:', {
      hasOauthToken: !!oauth_token,
      hasOauthVerifier: !!oauth_verifier,
      hasOauthTokenSecret: !!oauthTokenSecret,
      hasStoredOauthToken: !!storedOauthToken,
    });
    return res.status(400).send('Invalid OAuth callback parameters');
  }

  if (oauth_token !== storedOauthToken) {
    console.error('OAuth token mismatch:', { oauth_token, storedOauthToken });
    return res.status(400).send('OAuth token mismatch');
  }

  try {
    console.log('Attempting token exchange with:', {
      oauth_token: oauth_token || 'missing',
      oauth_verifier: oauth_verifier || 'missing',
      oauthTokenSecret: oauthTokenSecret || 'missing',
    });

    const userClient = await client.login(oauth_verifier, {
      oauth_token,
      oauth_token_secret: oauthTokenSecret,
    });

    console.log('Access token obtained:', {
      accessToken: userClient.accessToken,
      accessSecret: userClient.accessSecret,
    });

    const tweet = await userClient.v2.tweet('hi');

    req.session.destroy((err) => {
      if (err) console.error('Session destroy error:', err);
    });

    res.send(`
      <html>
        <body>
          <h1>Success!</h1>
          <p>Tweet posted: <a href="https://x.com/i/status/${tweet.data.id}" target="_blank">View on X</a></p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth/tweet error:', error.message, error.data);
    res.status(500).send(`OAuth or tweet error: ${error.message}<br><pre>${JSON.stringify(error.data || {}, null, 2)}</pre>`);
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});