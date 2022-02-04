const admin = require('firebase-admin');
admin.initializeApp();

// Database reference
const dbRef = admin.firestore().doc('tokens/demo');
const express = require('express');
const app = express();

// Twitter API init
const TwitterApi = require('twitter-api-v2').default;
const twitterClient = new TwitterApi({
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
});

const callbackURL = 'http://127.0.0.1:3000/callback';

// OpenAI API init
const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
  organization: 'YOUR_OPENAI_ORG',
  apiKey: 'YOUR_OPENAI_SECRET',
});
const openai = new OpenAIApi(configuration);

// STEP 1 - Auth URL
app.get('/auth', async (request, response) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
    callbackURL,
    { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
  );

  // store verifier
  await dbRef.set({ codeVerifier, state });

  response.redirect(url);
})

// STEP 2 - Verify callback code, store access_token 
app.get('/callback', async (request, response) => {
  const { state, code } = request.query;

  const dbSnapshot = await dbRef.get();
  const { codeVerifier, state: storedState } = dbSnapshot.data();

  if (state !== storedState) {
    return response.status(400).send('Stored tokens do not match!');
  }

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callbackURL,
  });

  await dbRef.set({ accessToken, refreshToken });

  const { data } = await loggedClient.v2.me(); // start using the client if you want

  response.send(data);
});

// STEP 3 - Refresh tokens and post tweets
app.get('/tweet', async (request, response) => {
  const { refreshToken } = (await dbRef.get()).data();

  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await dbRef.set({ accessToken, refreshToken: newRefreshToken });

  const nextTweet = await openai.createCompletion('text-davinci-001', {
    prompt: 'tweet something cool for #techtwitter',
    max_tokens: 64,
  });

  const { data } = await refreshedClient.v2.tweet(
    nextTweet.data.choices[0].text
  );

  response.send(data);
});

app.listen(3000)
console.log('Listening on port 3000 !')
