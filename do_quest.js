import ABI from './abi.js';
import Web3 from 'web3';
import { HttpsProxyAgent } from 'https-proxy-agent';
import Web3HttpProvider from 'web3-providers-http';
import moment from 'moment/moment.js';
import fetch from 'node-fetch'

const RPC_POLYGON = "https://rpc.ankr.com/polygon"
// const RPC_POLYGON = "https://polygon.llamarpc.com"
// const RPC_POLYGON = "https://endpoints.omniatech.io/v1/matic/mainnet/public"
// const RPC_POLYGON = "https://polygon-mainnet.g.alchemy.com/v2/xuHwGiqYNtGRPBSMFkkYKnKT3hqsv_Lc"
const CONTRACT_CAT_INFO = '0x7573933eb12fa15d5557b74fdaff845b3baf0ba2'

var sleep = (delay) => {
  var start = new Date().getTime();
  while (new Date().getTime() < start + delay);
}

var WEB3, CAT_INFO_CONTRACT
//  = new Web3(customProvider)
// const CAT_INFO_CONTRACT = new WEB3.eth.Contract(ABI, CONTRACT_CAT_INFO)

var getCatState = async () => {
  const catState = {}
  const catId = CURRENT_WALLET['cat_id']
  const catInfo = await CAT_INFO_CONTRACT.methods.getCatInfo2(catId).call()
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

  const canLevelUp = await CAT_INFO_CONTRACT.methods.canLevelUp(catId).call()
  catState.canLevelUp = canLevelUp


  // const configInfo = await CAT_INFO_CONTRACT.methods.getConfig2().call();
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

  const isCanFeed = await CAT_INFO_CONTRACT.methods.canFeed(catId).call();
  const isCanClean = await CAT_INFO_CONTRACT.methods.canClean(catId).call();
  const isCanPlay = await CAT_INFO_CONTRACT.methods.canPlay(catId).call();
  catState.isCanFeed = isCanFeed
  catState.isCanClean = isCanClean
  catState.isCanPlay = isCanPlay

  const pendingInviteList = await CAT_INFO_CONTRACT.methods.getPendingInvitesList(catId).call();
  catState.pendingInviteList = pendingInviteList

  const playInviteList = await CAT_INFO_CONTRACT.methods.getPlayInvitesList(catId).call();
  catState.playInviteList = playInviteList

  // console.log(`${CURRENT_WALLET['id']}. ${catState.}`)
  return catState
}

const sendTx = async (method, params) => {
  const address = CURRENT_WALLET['address']
  const privateKey = CURRENT_WALLET['private_key']
  let data = await CAT_INFO_CONTRACT.methods[method](...params).encodeABI()
  try {
    let gasPrice = Number(await WEB3.eth.getGasPrice())
    if (gasPrice > 60000000000) {
      sleep(60000)
      return { gas_high: gasPrice }
    }
    let gasLimit = await WEB3.eth.estimateGas({
      from: address,
      to: CONTRACT_CAT_INFO,
      data: data
    })
    let transaction = {
      from: address,
      to: CONTRACT_CAT_INFO,
      value: '0x',
      gasPrice: parseInt(gasPrice * 1.1),
      gas: parseInt(Number(gasLimit) * 1.2),
      data: data,
    }
    let signedTx = await WEB3.eth.accounts.signTransaction(transaction, privateKey)
    if (!signedTx['rawTransaction']) {
      _log(signedTx)
      return {}
    }
    return await WEB3.eth.sendSignedTransaction(signedTx.rawTransaction)
  } catch (e) {
    _log(e.reason)
    return e
  }
}

const _addSpace = (str, maxLength) => {
  let spaceCount = maxLength - str.length
  if (spaceCount > 0) {
    return str + Array(spaceCount).fill(' ').join('')
  }
  return str
}
const _log = (mess) => {
  let time = moment(new Date()).format("HH:mm:ss")
  let id = _addSpace(CURRENT_WALLET['id'], 3)
  let address = CURRENT_WALLET['address']
  let gen_id = CURRENT_WALLET['gen_id']
  let catId = _addSpace(CURRENT_WALLET['cat_id'], 11)
  console.log(`${time}. ${address} - ${catId} ${id} ${gen_id}. ${mess}`)
}

const doQuest = async () => {
  if (CURRENT_WALLET['proxy_url'] != '') {
    let proxyUrl = CURRENT_WALLET['proxy_url']
    const proxyAgent = new HttpsProxyAgent(CURRENT_WALLET['proxy_url']);

    const customHttpProvider = new Web3HttpProvider(RPC_POLYGON, { providerOptions: { agent: proxyAgent } });

    WEB3 = new Web3(customHttpProvider)
  } else {
    WEB3 = new Web3(new Web3.providers.HttpProvider(RPC_POLYGON))
  }

  CAT_INFO_CONTRACT = new WEB3.eth.Contract(ABI, CONTRACT_CAT_INFO)
  const catId = CURRENT_WALLET['cat_id']
  const catState = await getCatState()

  let rateLevel = 1
  let rateInLevel = catState.level - 1
  if (catState.level > 14) {
    rateLevel = 3
    rateInLevel = 14 + (catState.level - 15) * 3
  }

  const numFeedByLevel = 7 * rateInLevel
  const numCleanByLevel = 2 * rateInLevel
  const numPlayByLevel = 5 * rateInLevel

  const numFeedInLevel = catState.numFeeds - numFeedByLevel;
  const numCleanInLevel = catState.numCleans - numCleanByLevel;
  let numPlayInLevel = catState.numPlays - numPlayByLevel;
  let number = `lv:${catState.level} action:(${numFeedInLevel}-${numCleanInLevel}-${numPlayInLevel})(${catState.actionLimitCount}/15)`

  // ------------------------
  // numPlayInLevel = 0
  const accept_all = true
  const loop = true
  // ------------------------
  if (catState.level == 20) {
    _log(`${number} Done(${(new Date).getTime() + 10 * 60 * 60 * 1000 * 1000})`)
    process.send((new Date).getTime() + 10 * 60 * 60 * 1000 * 1000);
    process.exit();
  }
  if (catState.actionLimitReset * 1000 > (new Date).getTime() + 2 * 60 * 1000) {
    _log(`${number} Done(${new Date(catState.actionLimitReset * 1000)})`)
    if (loop) {
      process.send("loop");
    } else {
      process.send(catState.actionLimitReset * 1000);
    }
    process.exit();
  }

  if (catState.canLevelUp) {
    let txLevelUp = await sendTx('levelUp', [catId])
    if (txLevelUp['status']) {
      _log(`${number} Done: Level up`)
      process.send('');
      process.exit();
    } else {
      _log(JSON.stringify(txLevelUp))
    }
  }
  _log(`${number}`)

  // Feed
  let isSleepAction = false
  let isSleep = false
  if (numPlayInLevel >= 5 * rateLevel && numFeedInLevel < 7 * rateLevel && catState.isCanFeed) {
    let txFeed = await sendTx('feedCat', [catId])
    if (txFeed['status']) {
      isSleepAction = true
      isSleep = true
      _log(`${number} Done: Send Feed`)
    } else {
      _log(JSON.stringify(txFeed))
    }
  }

  // Clean
  if (numPlayInLevel >= 5 * rateLevel && numCleanInLevel < 2 * rateLevel && catState.isCanClean) {
    if (isSleepAction) { sleep(10000) }
    let txClean = await sendTx('cleanCat', [catId])
    if (txClean['status']) {
      isSleepAction = true
      isSleep = true
      _log(`${number} Done: Send Clean`)
    } else {
      _log(JSON.stringify(txClean))
    }
  }
  // Play

  let isSleepWaitPlay = true
  if (numPlayInLevel < 5 * rateLevel) {
    if (catState.isCanPlay) {
      if (isSleepAction) { sleep(10000) }
      if (CURRENT_WALLET['invite_cat_id'] != '') {
        let isSended = false
        catState.pendingInviteList.forEach(invite => {
          if (`${Number(invite['tokenId'])}` == CURRENT_WALLET['invite_cat_id']) {
            isSended = true
          }
        })
        if (!isSended) {
          let txInviteCat = await sendTx('inviteCatForPlaying', [catId, CURRENT_WALLET['invite_cat_id']])
          if (txInviteCat['status']) {
            isSleep = true
            _log(`${number} Done: Send Invite`)
          } else {
            _log(JSON.stringify(txInviteCat))
          }
        } else {
          isSleepWaitPlay = true
          _log(`${number} Wait cat`)
        }
      } else {
        let friendCatId = ''
        catState.playInviteList.forEach(invite => {
          if (accept_all) {
            friendCatId = CURRENT_WALLET['accept_cat_id']
          }
          else if (`${Number(invite['tokenId'])}` == CURRENT_WALLET['accept_cat_id']) {
            friendCatId = CURRENT_WALLET['accept_cat_id']
          }
        })
        if (friendCatId != '') {
          let txAcceptCat = await sendTx('acceptPlayDate', [catId, `${Number(catState.playInviteList[0].tokenId)}`])
          if (txAcceptCat['status']) {
            isSleep = true
            _log(`${number} Done: Send Accept`)
          } else {
            _log(JSON.stringify(txAcceptCat))
          }
        } else {
          isSleepWaitPlay = true
          _log(`${number} Wait invite`)
        }
      }
    }
  }
  if (isSleepAction || isSleepWaitPlay || isSleep) { sleep(60000) }
  process.send('');
  process.exit();

}

const CURRENT_WALLET = JSON.parse(process.argv[2])
doQuest()
