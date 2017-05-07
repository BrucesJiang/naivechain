'use strict';
var CryptoJS = require("crypto-js");
var express = require('express');
var WebSocket = require('ws');
var bodyParser = require('body-parser')


var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];

var sockets = [];
var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
};

/**
* 块结构：
* 在块结构中仅仅存储最为重要的部分： index(下标)、timestamp(时间戳)、data(数据)、hash(哈希值)
* previousHash(前置块哈希)
*/
class Block{
  constructor(index, previousHash, timestamp, data, hash){
    this.index = index;
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.data = data;
    this.hash = hash;
  }
}

/**
* 块存储, 创世区块采用硬编码
*/
var getGenesisBlock = () => {
  return new Block(0, "0", 1465154705, "my genesis block!!", "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
};

var blockchain = [getGenesisBlock()];

/**
  *块哈希
 * 对数据进行加密，保存完整数据块
*/
var calculateHash = (index, previousHash, timestamp, data)=>{
  return CryptoJS.SHA256(index+previousHash+timestamp+data).toString();
};

/**
* 计算块Hash
*/
var calculateHashForBlock = (block) => {
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data);
};

/**
* 块生成
*/
var generateNextBlock = (blockData)=>{
  var previousBlock = getLatestBlock();
  var nextIndex = previousBlock.index + 1;
  var nextTimestamp = new Date().getTime()/1000;
  var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData);
  return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash);
};

/**
* 确认链的完整性
*/
var isValidNewBlock = (newBlock, previousBlock)=>{

  if(previousBlock.index + 1 !== newBlock.index){// 块编号合法性
    console.log('块编号不合法');
    return false;
  }else if(previousBlock.hash !== newBlock.previousHash){ //前置块哈希合法性
    console.log('前置块哈希不合法');
    return false;
  }else if(calculateHashForBlock(newBlock) !== newBlock.hash){ //本区块哈希合法性
    console.log('本区块哈希不合法');
    return false;
  }
  return true;
};

/**
* 最长链选择
*  当有多个节点同时产生新的区块，此时产生冲突，我们默认选择最长的链
*/
var replaceChain = (newBlocks)=> {
  if(isValidChain(newBlocks) && newBlocks.length > blockchain.length){
    console.log('接收的链是合法的, 将当前链替换为接收链');
    blockchain = newBlocks;
    broadcast(responseLatestMsg());
  }else{
    console.log('接收的新块不合法')
  }
};

/**
* 向链上添加新的块
*/
var addBlock = (newBlock) => {
  if(isValidNewBlock(newBlock, getLatestBlock())){
    blockchain.push(newBlock);
  }
};


/**
*  连接到节点
*/
var connectToPeers = (newPeers) => {
  newPeers.forEach((peer)=> {
    var ws = new WebSocket(peer);
    ws.on('open', () => initConnection(ws));
    ws.on('error', () => {
      console.log('connection failed');
    });
  });
};

var handleBlockchainResponse = (message) => {
  var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index-b2.index));
  var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
  var latestBlockHeld = getLatestBlock();
  if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain");
            blockchain.push(latestBlockReceived);
            broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer");
            broadcast(queryAllMsg());
        } else {
            console.log("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);
        }
    } else {
        console.log('received blockchain is not longer than received blockchain. Do nothing');
    }
};

var replaceChain = (newBlocks) => {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else {
        console.log('Received blockchain invalid');
    }
};

var isValidChain = (blockchainToValidate) => {
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

var getLatestBlock = () => blockchain[blockchain.length - 1];
var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});
var responseChainMsg = () =>({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
});
var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));


/**
* 通信
* 结点的本质是和其他结点共享和同步区块链，下面的规则能保证网络同步。
* •	当一个结点生成一个新块时，它会在网络上散布这个块。
* •	当一个节点连接新peer时，它会查询最新的block。
* •	当一个结点遇到一个块，其index大于当前所有块的index时，它会添加这个块到它当前的链中，或者到整个区块链中查询这个块。
*
*/

var initHttpServer = () =>{
  var app = express();
  app.use(bodyParser.json());

  app.get('/blocks', (req, res)=>{res.send(JSON.stringify(blockchain))});
  app.post('/mineBlock', (req, res)=>{
    var newBlock = generateNextBlock(req.body.data);
    addBlock(newBlock);
    broadcast(responseLatestMsg());
    console.log('block added:' + JSON.stringify(newBlock));
    res.send();
  });
  app.get('peers', (req, res)=>{
    res.send(sockets.map(s=>s._socket.remoteAddress + ':' + s._socket.remotePort));
  });

  app.post('/addPeer', (req, res)=>{
    connectToPeers([req.body.peer]);
    res.send();
  });
  app.listen(http_port, ()=>console.log("Listening http on port : " + http_port));
};


var initMessageHandler = (ws) =>{
  ws.on('message', (data) => {
    var message = JSON.parse(data);
    console.log('Received message' + JSON.stringify(message));
    switch(message.type){
      case MessageType.QUERY_LATEST:
       write(ws, responseLatestMsg());
       break;
      case MessageType.QUERY_ALL:
        write(ws, responseChainMsg());
        break;
      case MessageType.RESPONSE_BLOCKCHAIN:
        handleBlockchainResponse(message);
        break;
    }
  });
};


var initErrorHandler = (ws) => {
  var closeConnection = (ws) => {
    console.log('connection failed to peer : ' + ws.url);
    sockets.splice(sockets.indexOf(ws), 1);
  };
  ws.on('close', () => closeConnection(ws));
  ws.on('error', () => closeConnection(ws));
};


var initConnection = (ws) => {
  sockets.push(ws);
  initMessageHandler(ws);
  initErrorHandler(ws);
  write(ws, queryChainLengthMsg());
};



var initP2PServer = () => {
    var server = new WebSocket.Server({port: p2p_port});
    server.on('connection', ws => initConnection(ws));
    console.log('listening websocket p2p port on :' + p2p_port);
};



connectToPeers(initialPeers);
initHttpServer();
initP2PServer();
