import 'dotenv/config';
import fetch from 'node-fetch';
import { readFile } from 'fs/promises';
import createPrompt from 'prompt-sync';
const prompt = createPrompt({ sigint: true });
import Web3 from 'web3';
import csvdb from 'csv-database';
import { fork } from 'child_process';
import { HttpsProxyAgent } from 'https-proxy-agent';

import ABI from './abi.js'
// import {doQuest} from './do_quest.js'

const RPC_POLYGON = "https://polygon-rpc.com/"
const CONTRACT_ADDRESS = '0xa4Aff9170C34c0e38Fed74409F5742617d9E80dc'
const CONTRACT_CAT = '0xa4Aff9170C34c0e38Fed74409F5742617d9E80dc'
const CONTRACT_CAT_INFO = '0x7573933eb12fa15d5557b74fdaff845b3baf0ba2'
const DB_NAME = "database.csv"
var DB, CURRENT_WALLET, ACTION, DEFAULT_ID = 0, WALLET_COUNT = 0, WALLET_DONE = [], PROXY_AGENT
const MAX_FEED = 7, MAX_CLEAN = 5, MAX_PLAY = 2

const web3 = new Web3(new Web3.providers.HttpProvider(RPC_POLYGON))
const catContract = new web3.eth.Contract(ABI, CONTRACT_CAT)
const catInfoContract = new web3.eth.Contract(ABI, CONTRACT_CAT_INFO)
var buildProxy = () => {
  if (CURRENT_WALLET['proxy_url'] == '') {
    return
  }

  let proxyUrl = CURRENT_WALLET['proxy_url']
  return new HttpsProxyAgent(proxyUrl)
}

var sleep = (delay) => {
  var start = new Date().getTime();
  while (new Date().getTime() < start + delay);
}
var getCatId = async () => {
  let response = await fetch(`https://api.token-discovery.tokenscript.org/get-owner-tokens?smartContract=0xD5cA946AC1c1F24Eb26dae9e1A53ba6a02bd97Fe&chain=polygon&owner=${CURRENT_WALLET['address']}&blockchain=evm`,
    {
      method: 'GET'
    }).then(r => { return r.json() })

  console.log(response.length)
  if (response.length > 0) {
    console.log(CURRENT_WALLET['id'], response[0].tokenId)
    await DB.edit({ id: CURRENT_WALLET['id'] }, { cat_id: response[0].tokenId })
  }
  sleep(1000)
  return getCurrentWallet(parseInt(CURRENT_WALLET['id']) + 1)
}
var getCatState = async () => {
  const catState = {}
  const catId = CURRENT_WALLET['cat_id']
  const catInfo = await catInfoContract.methods.getCatInfo2(catId).call()
  const {
    0: level,
    1: numFeeds,
    2: lastFeed,
    3: numPlays,
    4: lastPlay,
    5: numCleans,
    6: lastClean,
    7: friends
  } = catInfo[0]
  catState.level = Number(level)
  catState.numFeeds = Number(numFeeds);
  catState.lastFeed = Number(lastFeed);
  catState.numPlays = Number(numPlays);
  catState.lastPlay = Number(lastPlay);
  catState.numCleans = Number(numCleans);
  catState.lastClean = Number(lastClean);
  catState.friends = Array.from(friends);
  catState.pointsBalance = Number(catInfo[1]);
  catState.actionLimitReset = Number(catInfo[2]);
  catState.actionLimitCount = Number(catInfo[3]);

  const canLevelUp = await catInfoContract.methods.canLevelUp(catId).call()
  catState.canLevelUp = canLevelUp


  // const configInfo = await catInfoContract.methods.getConfig2().call();
  // console.log(configInfo)
  // const thresholds = configInfo[1];

  // const levelThresholds = {
  //   feed: thresholds[0],
  //   play: thresholds[1],
  //   clean: thresholds[2]
  // };

  // const actionLimits = configInfo[0];

  // const maxActions = configInfo[3];

  catState.nextFeed = Math.max((catState.lastFeed + 60), (catState.actionLimitReset));
  catState.nextPlay = Math.max((catState.lastPlay + 60), (catState.actionLimitReset));
  catState.nextClean = Math.max((catState.lastClean + 60), (catState.actionLimitReset));

  const isCanFeed = await catInfoContract.methods.canFeed(catId).call();
  const isCanClean = await catInfoContract.methods.canClean(catId).call();
  const isCanPlay = await catInfoContract.methods.canPlay(catId).call();
  catState.isCanFeed = isCanFeed
  catState.isCanClean = isCanClean
  catState.isCanPlay = isCanPlay

  const pendingInviteList = await catInfoContract.methods.getPendingInvitesList(catId).call();
  catState.pendingInviteList = pendingInviteList

  const playInviteList = await catInfoContract.methods.getPlayInvitesList(catId).call();
  catState.playInviteList = playInviteList

  console.log(catState)
  return catState
}

var sendTx = async (method, params) => {
  const address = CURRENT_WALLET['address']
  const privateKey = CURRENT_WALLET['private_key']
  let data = await catInfoContract.methods[method](...params).encodeABI()
  let gasPrice = await web3.eth.getGasPrice()
  let gasLimit = await web3.eth.estimateGas({
    from: address,
    to: CONTRACT_CAT_INFO,
    data: data
  })
  let transaction = {
    from: address,
    to: CONTRACT_CAT_INFO,
    value: '0x',
    gasPrice: Number(gasPrice),
    gas: Number(gasLimit),
    data: data,
  }
  try {
    let signedTx = await web3.eth.accounts.signTransaction(transaction, privateKey)
    if (!signedTx['rawTransaction']) {
      console.log("-> Error!!!")
      console.log(signedTx)
      return
    }
    let tx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
    return tx
  } catch (e) {
    console.log(e.reason)
    return e
  }
}

var doQuest = async () => {
  const catId = CURRENT_WALLET['cat_id']
  const catState = await getCatState()

  if (catState.actionLimitCount >= 15) {
    console.log('-> Limit action')
    let lastTimeInDay = new Date()
    lastTimeInDay.setHours(23, 59, 59, 999);
    let doneTime = Math.min(...[
      catState.actionLimitReset * 1000,
      lastTimeInDay
    ])
    await DB.edit({ id: CURRENT_WALLET['id'] }, { done_time: doneTime })
    return getCurrentWallet(parseInt(CURRENT_WALLET['id']) + 1)
  }

  if (catState.canLevelUp) {
    console.log(`Level up(${catState.level})...`)
    let txLevelUp = await sendTx('levelUp', [catId])
    if (txLevelUp['status']) {
      console.log(`-> Done`)
      let lastTimeInDay = new Date()
      lastTimeInDay.setHours(23, 59, 59, 999);
      await DB.edit({ id: CURRENT_WALLET['id'] }, { done_time: lastTimeInDay.getTime() })
    } else {
      console.log("-> Error!!!")
      console.log(txLevelUp)
    }
  }

  const numFeedOfLevel = catState.numFeeds - 7 * (catState.level - 1);
  const numCleanOfLevel = catState.numCleans - 2 * (catState.level - 1);
  const numPlayOfLevel = catState.numPlays - 5 * (catState.level - 1);

  // Feed
  if (numFeedOfLevel < 7) {
    if (catState.isCanFeed) {
      console.log(`Feeding(${catState.numFeeds}/7)...`)
      let txFeed = await sendTx('feedCat', [catId])
      if (txFeed['status']) {
        console.log(`-> Done`)
      } else {
        console.log("-> Error!!!")
        console.log(txFeed)
      }

    } else {
      console.log(`Feed(${catState.numFeeds}/7) timeout`)
    }
  } else {
    console.log(`Feed(${catState.numFeeds}/7)`)
  }

  // Clean
  if (numCleanOfLevel < 2) {
    if (catState.isCanClean) {
      console.log(`Cleaning(${catState.numCleans}/2)...`)
      let txClean = await sendTx('cleanCat', [catId])
      if (txClean['status']) {
        console.log(`-> Done`)
      } else {
        console.log("-> Error!!!")
        console.log(txClean)
      }
    } else {
      console.log(`Clean(${catState.numCleans}/2) timeout`)
    }
  } else {
    console.log(`Clean(${catState.numCleans}/2)`)
  }

  if (numPlayOfLevel < 5) {
    if (catState.isCanPlay) {
      console.log(`Playing(${catState.numPlays}/5)...`)
      if (CURRENT_WALLET['friend_cat_id'] != '') {
        if (catState.pendingInviteList.length == 0) {
          let txInviteCatForPlaying = await sendTx('inviteCatForPlaying', [catId, CURRENT_WALLET['friend_cat_id']])
          if (txInviteCatForPlaying['status']) {
            console.log(`-> Done`)
          } else {
            console.log("-> Error!!!")
            console.log(txInviteCatForPlaying)
          }
        } else {
          console.log(`Have pending cat ${CURRENT_WALLET['friend_cat_id']}`)
        }
      } else {
        if (catState.playInviteList.length > 0) {
          let txAcceptPlayDate = await sendTx('acceptPlayDate', [catId, `${Number(catState.playInviteList[0].tokenId)}`])
          if (txAcceptPlayDate['status']) {
            console.log(`-> Done`)
          } else {
            console.log("-> Error!!!")
            console.log(txAcceptPlayDate)
          }
        } else {
          console.log('Play invite list empty, wait send invite')
        }
      }
    } else {
      console.log(`Play(${catState.numPlays}/5) timeout`)
    }
  } else {
    console.log(`Play(${catState.numPlays}/5)`)
  }

  return getCurrentWallet(parseInt(CURRENT_WALLET['id']) + 1)
}

var requestPostSmartlayer = async (url, body) => {
  let headers = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "vi",
    "authorization": `Bearer ${CURRENT_WALLET['token']}`,
    "content-type": "application/json",
    "sec-ch-ua": "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site"
  }

  let options = {
    "credentials": "include",
    "headers": headers,
    "referrer": "https://www.smartlayer.network/",
    "body": body,
    "method": 'POST',
    "mode": "omit"
  }

  let response = await fetch(url, options).then(r => {
    if (r.ok) {
      const contentType = r.headers.get('Content-Type');
      if (contentType) {
        if (contentType.includes('text/event-stream')) {
          return { success: true }
        } else if (contentType.includes('text/html')) {
          return r.text()
        } else {
          return r.json()
        }
      }
    } else {
      return r.text()
    }
  })
  return response
}

var migrate = async () => {
  let message = {
    address: CURRENT_WALLET['address'],
    email: CURRENT_WALLET['email']
  }
  const web3Account = web3.eth.accounts.privateKeyToAccount(CURRENT_WALLET['private_key'])
  const signature = web3Account.sign(JSON.stringify(message))

  let body = {
    signedToken: CURRENT_WALLET['sign_token'],
    address: CURRENT_WALLET['address'],
    signature: signature.signature
  }
  let response = await requestPostSmartlayer(`https://backend.smartlayer.network/passes/1/${CURRENT_WALLET['pass_id']}/import-attestation`, body)
  console.log(response)

}

const ACTIONS = {
  '1': {
    code: 'do_task_all',
    name: 'Do task all.'
  },
  '2': {
    code: 'do_task',
    name: 'Do task one.'
  },
  '3': {
    code: 'update_cat',
    name: 'Update cat id.'
  },
  '4': {
    code: 'migrate',
    name: 'Migrate.'
  },
}

var init = async () => {
  DB = await csvdb(DB_NAME, [
    'id',
    'gen_id',
    'address',
    'private_key',
    'cat_id',
    'invite_cat_id',
    'accept_cat_id',
    'email',
    'pass_id',
    'token',
    'sign_token',
    'point',
    'done_time',
    'proxy_url'
  ], ',');
  let wallets = await DB.get()
  DEFAULT_ID = wallets[0].id
  WALLET_COUNT = wallets.length
}

var getCurrentWallet = async (id) => {
  CURRENT_WALLET = await DB.get({ id: `${id}` })
  if (CURRENT_WALLET.length == 0) {
    console.log("END")
    return
  }

  CURRENT_WALLET = CURRENT_WALLET[0]
  // let currentTime = new Date()
  // if(CURRENT_WALLET['done_time'] > currentTime.getTime()){
  //   if(!WALLET_DONE.includes(CURRENT_WALLET['id'])){
  //     WALLET_DONE.push(CURRENT_WALLET['id'])
  //   }
  //   return getCurrentWallet(parseInt(CURRENT_WALLET['id']) + 1)
  // }
  console.log()
  console.log(`${CURRENT_WALLET['id']}. ${CURRENT_WALLET['address']} - ${CURRENT_WALLET['cat_id']}`)
  PROXY_AGENT = buildProxy()

  if (ACTION == ACTIONS['2']['code']) {
    return doQuest()
  }
  if (ACTION == ACTIONS['3']['code']) {
    return getCatId()
  }
  if (ACTION == ACTIONS['4']['code']) {
    return migrate()
  }
}


var CHILD_PROCESS_TIMES = []
var TOTAL_COUNT = 0

var runAll = async () => {
  let allWallets = await DB.get()
  TOTAL_COUNT = allWallets.length
  allWallets.forEach(w => {
    _startChild(w)
  })
}

var _startChild = (wallet) => {
  const childProcess = fork('./do_quest.js', [
    JSON.stringify(wallet)
  ])
  childProcess.on('message', (message) => {
    if (message != '') {
      if (message == "loop") {
        setTimeout(() => {
          _startChild(wallet)
        }, 60000)
      } else {
        CHILD_PROCESS_TIMES.push(message)
      }
    } else {
      _startChild(wallet)
    }
    if (CHILD_PROCESS_TIMES.length == TOTAL_COUNT) {
      console.log(`------ Next run: ${new Date(Math.min(...CHILD_PROCESS_TIMES))}`)
    }
  })
}

// var runAll = ()=>{
//   for(let i=0;i<12;i++){
//     setTimeout(()=>{
//       _runAll()
//     }, i*5*60*1000)
//   }
// }

var index = async () => {
  await init()
  let deft = '1'
  Object.keys(ACTIONS).forEach((k) => {
    console.log(`${k}. ${ACTIONS[k]['name']}`)
  })
  // let choose = prompt(`choose(default ${deft}): `)
  // let act = ACTIONS[choose] || ACTIONS[deft]
  let act = ACTIONS[deft]
  ACTION = act['code']
  if (ACTION == ACTIONS['1']['code']) {
    return runAll()
  } else {
    console.log()
    let id = prompt(`select account id(default ${DEFAULT_ID}): `)
    id = id || DEFAULT_ID
    console.log()
    return getCurrentWallet(id)
  }
}

index()
