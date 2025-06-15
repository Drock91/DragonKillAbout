
const xrpl = require("xrpl");
const app = express();
const {XummSdk} = require('xumm-sdk')


app.use(cors()); // Allow all origins 
app.use('/transmute', limiter);
app.use('/register', limiter);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());



//Checks if player has a trustline for DKP
async function checkTrustline(account) {
  // Connect to XRPL
  const client = new xrpl.Client('wss://xrplcluster.com')
  await client.connect()

  // Fetch account lines (trustlines)
  const accountLines = await client.request({
    command: 'account_lines',
    account: account,
  })

  await client.disconnect()

  // Check if the account has the specified trustline
  const trustlines = accountLines.result.lines || []
  for (const line of trustlines) {
    if (line.currency === "DKP" && line.account === "rM7zpZQBfz9y2jEkDrKcXiYPitJx9YTS1J") {
      return true // Trustline found
    }
  }

  return false // Trustline not found
}
// api sends DKP to the players wallet when they do a 1 for 1 trade with the web2 in-game currency to the web3 currency DKP on the XRPL
app.post('/dkpsend', async (req, res, next) => {
  console.log('We are listening')
  const apiKeyFromRequest = req.headers['x-api-key'];
    const apiKeyFromEnv = process.env.CONVO_KEY;

    if (apiKeyFromRequest !== apiKeyFromEnv) {
        res.status(401).json({message: 'Unauthorized'});
        return;
    }
  if (!req.body.userId || !req.body.walletAddress || !req.body.goldAmount) {
    res.status(400).send("Bad Request: Missing required parameters.");
    return;
  }
  const client = new xrpl.Client("wss://xrplcluster.com");
  await client.connect();
  const dkpWallet = xrpl.Wallet.fromSeed(process.env.SENDER_SEED);
  const currency_code = "DKP"
  // Send token ----------------------------------------------------------------
  const issue_quantity = req.body.goldAmount
  const send_token_tx = {
    "TransactionType": "Payment",
    "Account": process.env.SENDER_PUBLIC,
    "Amount": {
      "currency": currency_code,
      "value": req.body.goldAmount,
      "issuer": "rM7zpZQBfz9y2jEkDrKcXiYPitJx9YTS1J"
    },
    "Destination": req.body.walletAddress
  }
  const pay_prepared = await client.autofill(send_token_tx)
  const pay_signed = dkpWallet.sign(pay_prepared)
  const pay_result = await client.submitAndWait(pay_signed.tx_blob)
  console.log(pay_result);
  if (pay_result.result.meta.TransactionResult == "tesSUCCESS") {
    console.log(`Transaction succeeded: https://mainnet.xrpl.org/transactions/${pay_signed.hash}`)
    let xrpBalance = await client.getXrpBalance(req.body.walletAddress);
    let dkpBalance = "0";
    const balances = await client.getBalances(req.body.walletAddress);
    for (const balance of balances) {
      if (balance.currency === 'DKP') {
        dkpBalance = balance.value;
      }
    }
    const responseObj = {
      success: 'true',
      message: 'Transaction and gold removal successful',
      details: {
        userId: req.body.userId,
        goldAmount: req.body.goldAmount,
        walletAddress: req.body.walletAddress,
        xrpBalance: xrpBalance,
        dkpBalance: dkpBalance
      }
    }   
    res.status(200).json(responseObj);
  console.log(responseObj);
} else {
  console.log(responseObj);
  console.log("failed");
  const responseObj = {
    success: 'false',
    message: 'Transaction and gold removal successful',
    details: {
        userId: userId,
        goldAmount: goldAmount,
        walletAddress: req.body.walletAddress
        //xrpBalance: xrpBalance,  // Added XRP balance
        //dkpBalance: dkpBalance   // Added DKP balance
    }
  };
  res.status(200).json(responseObj);
  console.log(responseObj);
  throw `Error sending transaction: ${pay_result.result.meta.TransactionResult}`
}
client.disconnect()
});

// Gets the best price for DKP for the client when they try to purchase DKP in-game with their Xaman wallet
app.post('/GetMarketPrice', async (req, res) => {
  const apiKeyFromRequest = req.headers['x-api-key'];
    const apiKeyFromEnv = process.env.CONVO_KEY;
    if (apiKeyFromRequest !== apiKeyFromEnv) {
        res.status(401).json({message: 'Unauthorized'});
        return;
    }
  const desiredAmount = parseFloat(req.body.amount);  
    // Initialize an XRPL client and connect to it
  const client = new xrpl.Client('wss://xrplcluster.com');
  await client.connect();
   // Request the order book for XRP to DKP
   const orderBook = await client.request({
    command: 'book_offers',
    taker_pays: {
      currency: 'XRP'
    },
    taker_gets: {
      currency: 'DKP',
      issuer: 'rM7zpZQBfz9y2jEkDrKcXiYPitJx9YTS1J'
    },
    limit: 1000
  });
  await client.disconnect();
  // Sort the offers by rate in ascending order
  orderBook.result.offers.sort((a, b) => parseFloat(a.quality) - parseFloat(b.quality));
    // Initialize variables to hold aggregate liquidity and best rate
  let aggregateLiquidity = 0;
  let bestRate = 0;
    // Loop through sorted offers to find the best rate that can fulfill the desired amount
  for (const offer of orderBook.result.offers) {
    const availableDKP = parseFloat(offer.TakerGets.value);
    aggregateLiquidity += availableDKP;
    if (aggregateLiquidity >= desiredAmount) {
      bestRate = parseFloat(offer.quality);
      break;
    }
  }
   // Check if there's enough liquidity to fulfill the request
  if (bestRate === 0) {
    console.log('Not enough liquidity to fulfill 50,000 DKP.');
    res.json({ meta: { error: 'Not enough liquidity' } });
    return;
  }
  const bestMarketPrice = ((bestRate / 1000000 )* desiredAmount).toString();
  console.log(bestMarketPrice + " was our best market price");
  //sending the best market price for the amount we have requested, this wil be created in the game server now via xumm rest api
  const xummDetailedResponse = {
    meta: {
      bestMarketPrice: bestMarketPrice,
    }
  };
  res.json(xummDetailedResponse);
});

// this is the integration API utilizing XRPL Grant wave 6 winners Nexus API
async function getSmartCallNFTTransaction(smartcall, token) {
  const url = baseNexusURLStaging + smartCallTXURL + smartcall; // Construct the endpoint
  const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
  };

  const maxAttempts = 5; // Maximum retry attempts
  let attempts = 0;

  while (attempts < maxAttempts) {
      console.log(`Attempt ${attempts + 1} to fetch NFT transaction...`);
      try {
          // Add a delay between retries, except for the first attempt
          if (attempts > 0) await delay(8000); // 8-second delay

          // Send the GET request
          const response = await fetch(url, {

              method: "GET",
              headers: headers
          });

          // Parse the JSON response
          const data = await response.json();

          // Log the response for debugging
          console.log("Response from server:", data);

          // Check if the response is okay
          if (!response.ok) {
              console.error(`Error: ${response.status} ${response.statusText}`, data);
              return null;
          }

          // Check if `nft_mint_transaction_id` is valid
          const nftMintTransactionId = data.data?.[0]?.nft_mint_transaction_id;
          if (nftMintTransactionId) {
              const nftTokenID = await getNftTokenId(nftMintTransactionId);
              return nftTokenID;
          } else {
              console.log("nft_mint_transaction_id is null or empty, retrying...");
          }

      } catch (error) {
          console.error(`Error during attempt ${attempts + 1}:`, error.message);
      }

      attempts++;
  }

  console.error("Failed to fetch a valid NFT transaction after maximum attempts.");
  return null; // Return null if all attempts fail
}
// mints MNTS, this is important because from here we will be saving the Data in a mongoDB collection which has every NFT ever made in DragonKill with mutable data and API to access each NFTS specific data.
// this centralized NFT storage method allows for NFTs have different levels for weapons, item storage inside for example in a storage big of an NFT house, etc. that can all be accessed and saved without needed to burn and remint NFTS

const MintingNFT = async (data) => {
  // Logic for updating subscription

  const { buildID, sessionID, tactician, playfab, NFT_Name, Level, Cooldowns, Attributes, Type } = data;
  const apiKeyFromEnv = process.env.CONVO_KEY;
  if (tactician !== apiKeyFromEnv) {
      console.log('Unauthorized: Invalid API key');
      return null;
  }
  try {
    const subUpdated = await MintNFT(NFT_Name, playfab);
    if(subUpdated){
      return subUpdated;
    }
  }
  catch (error) {
      // Check if the error message indicates an authentication error
        // Handle other errors
        return { message: 'An error occurred during minting.', error: error.message };
   }

};
//fetches all NFTs from DragonKill in a players wallet
async function getNFTsByIssuer(wallet, issuer = "rhB7i1DDJAmw1A3sVi6nR89GWcUkNPo6KJ") {
  return new Promise(async (resolve) => {
      try {
          const client = new xrpl.Client("wss://xrplcluster.com");
          await client.connect();
          console.log('Connected to XRPL');

          // Request all NFTs for the specified wallet address
          const response = await client.request({
              command: "account_nfts",
              account: wallet,
              ledger_index: "validated"
          });

          await client.disconnect();

          // Filter NFTs to only include those issued by the specified account
          const filteredNFTs = response.result.account_nfts.filter(nft => nft.Issuer === issuer);

          // Resolve with the filtered list or empty array if none found
          resolve(filteredNFTs.length > 0 ? filteredNFTs : []);
      } catch (error) {
          console.error("Error fetching NFTs:", error);
          resolve([]); // Resolve with an empty array on error
      }
  });
}
//used to fetch balance of a players DKP from their XRP account
app.post('/balance', async (req, res, next) => {
  var wallet = req.get(req.body.wallet);
  console.log(req.body.wallet);
  const client = new xrpl.Client("wss://xrplcluster.com")
  await client.connect()
  console.log('We are listening')
  const response = await client.request({
    "command": "account_lines",
    "account": req.body.wallet,
    "ledger_index": "validated",
    "peer": "rM7zpZQBfz9y2jEkDrKcXiYPitJx9YTS1J"
})
var json = {};
json.balance = response.result.lines[0].balance;
json.currency = response.result.lines[0].currency;
res.send(response.result.lines[0].balance);
console.log("Client has " + response.result.lines[0].balance + " DKP in their wallet.");
client.disconnect()
}
);

// fetches DKP balance for website when players login to view their data
async function getDKPBalance(wallet) {
  return new Promise(async (resolve) => {
      try {
          const client = new xrpl.Client("wss://xrplcluster.com");
          await client.connect();
          console.log('Connected to XRPL');

          // Fetch the DKP balance for the wallet
          const response = await client.request({
              command: "account_lines",
              account: wallet,
              ledger_index: "validated",
              peer: "rM7zpZQBfz9y2jEkDrKcXiYPitJx9YTS1J" // Specify the issuer's address for DKP
          });

          await client.disconnect();

          if (response.result.lines && response.result.lines.length > 0) {
              // Assuming DKP is in the first line; adjust if needed
              const balance = response.result.lines[0].balance;
              const currency = response.result.lines[0].currency;
              console.log(`Client has ${balance} ${currency} in their wallet.`);
              
              // Resolve with balance information
              resolve({ balance, currency });
          } else {
              // Resolve with null if no balance is found
              resolve(null);
          }
      } catch (error) {
          console.error("Error fetching DKP balance:", error);
          resolve(null); // Resolve with null on error
      }
  });
}
//login with a registered Xaman wallet
async function startloginXaman() {
    const url = baseNexusURL + "xaman/user/login"; 
    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "nexus-key": process.env.NEXUS_PUBIC_KEY,
        "nexus-secret": process.env.NEXUS_SECRET_KEY
    };
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
        });
        const data = await response.json();
        //console.log("our data is ", data);
        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`, data);
            return null;
        }
        return data; // Return the response data if needed
    } catch (error) {
        console.error("Error during login:", error.message);
        return null;
    }
}
async function loginXamanAccessToken(uuid) {
    const url = baseNexusURL + "xaman/user"; 
    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "nexus-key": process.env.NEXUS_PUBIC_KEY,
        "nexus-secret": process.env.NEXUS_SECRET_KEY
    };
    
    const body = JSON.stringify({
      login_uuid: uuid
  });
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: body
        });
        const data = await response.json();
        console.log("our data for xaman user is ", data);
        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`, data);
            return null;
        }
        const userAccessToken = await loginXamanUser(data.user, uuid)
        return userAccessToken; // Return the response data if needed
    } catch (error) {
        console.error("Error during xaman get user login:", error.message);
        return null;
    }
}
async function FinishloginXamanUser(user, uuid) {
    const url = baseNexusURL + "xaman/user/getAccessToken"; 
    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "nexus-key": process.env.NEXUS_PUBIC_KEY,
        "nexus-secret": process.env.NEXUS_SECRET_KEY
    };
   
    const body = JSON.stringify({
      user_token: user.user_token,
      login_uuid: uuid
  });
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: body
        });
        const data = await response.json();
        console.log("our data for xaman user GET ACCESS TOKEN is ", data);
        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`, data);
            return null;
        }
        return data.access_token; // Return the response data if needed
    } catch (error) {
        console.error("Error during xaman get user login:", error.message);
        return null;
    }
}
