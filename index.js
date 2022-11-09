//set up express server stuff
var express = require("express");
var app = express();
var server = require("http").Server(app);

//set up websocket servers for signalling webrtc
var WebSocket = require("ws");
var signalWss = new WebSocket.Server({noServer: true});

//set up other libraries
var {v4: uuidV4} = require("uuid");
var url = require("url");

//set the view engine as ejs for rendering the views
app.set("view engine", "ejs");
app.use(express.static("views"));

//a get path for connecting to the network
app.get("/", async (req, res) => {
	return res.render("room.ejs");
});

//handle server upgrades to websockets
server.on("upgrade", (req, socket, head) => {
	var pathname = url.parse(req.url).pathname;

	switch (pathname) {
		case "/signal":
			console.log("WebRTC signalling server connection...");

			//handle the connection upgrade to websockets
			signalWss.handleUpgrade(req, socket, head, (ws) => {
				signalWss.emit("connection", ws, req);
			});
	}
});

global.signalClients = {};

//listen for connections on the signalling server
signalWss.on("connection", async (ws, req) => {
	ws.on("message", (message) => {
		var messagedata = JSON.parse(message);

		switch (messagedata.event) {
			case "join-net":
				console.log("JOINING NETWORK");

				//get the room from the signal clients array
				var room = global.signalClients;

				//add this client to the network
				room[messagedata.userid] = {userid: messagedata.userid, socket: ws};

				break;
			case "get-peers":
				console.log("USER REQUESTING PEERS");

				var room = [];

				var peerlength = Object.values(global.signalClients).length;

				//pick 6 random peers to add to the array
				for (var i = 0; i < 6; i++) {
					//pick a random peer in the signal clients
					var randompeer = Object.values(global.signalClients)[Math.round(Math.random()*(peerlength-1))];
					room.push(randompeer);
				}

				console.log(room);

				//make sure the peers are different than the original user
				room = room.filter((client) => {
					return client.userid != messagedata.userid;
				});

				//get the peer ids currently in the room
				var peerids = room.map((peer) => {
					return peer.userid;
				});
				peerids = peerids.filter((client) => {
					return client.userid != messagedata.userid;
				});

				//send peer ids to the user
				var peersObj = JSON.stringify({event: "get-peers", peers: peerids, userid: messagedata.userid});

				console.log(room);
				console.log(messagedata.userid);

				global.signalClients[messagedata.userid].socket.send(peersObj);

				break;
			case "sdp-offer":
				console.log("SDP OFFER FROM", messagedata.userid);

				var room = global.signalClients;

				//send the sdp offer to all the direct peers of the user
				var sdpOffer = JSON.stringify({offer: messagedata.offer, event: "sdp-offer", userid: messagedata.userid});

				console.log(messagedata.peers);

				for (var peer of messagedata.peers) {
					room[peer].socket.send(sdpOffer);
				}

				break;
			case "sdp-answer":
				console.log("SDP ANSWER FROM", messagedata.userid);

				var room = global.signalClients;

				//send the sdp answer to the recipient
				var sdpAnswer = JSON.stringify({answer: messagedata.answer, event: "sdp-answer", userid: messagedata.userid});
				room[messagedata.userid].socket.send(sdpAnswer);

				break;
			case "ice-exchange":
				console.log("ICE CANDIDATE FROM", messagedata.userid);

				var room = global.signalClients;

				//send the ice candidate to all direct peers
				var iceCandidate = JSON.stringify({event: "ice-exchange", candidate: messagedata.candidate, userid: messagedata.userid});
				for (var peer of messagedata.peers) {
					room[peer].socket.send(iceCandidate);
				}

				break;
			case "answer-pong":
				console.log("ANSWER PONG FROM", messagedata.userid);

				var room = global.signalClients;

				//send the answer pong to the recipient
				var answerPong = JSON.stringify({event: "answer-pong", userid: messagedata.userid});
				room[messagedata.recipient].socket.send(answerPong);

				break;
			case "webrtc-failed":
				console.log("WEBRTC CONNECTION FAILED FOR", messagedata.userid, "SENDING MESSAGE TO", messagedata.recipient);

				var room = global.signalClients;

				var failedObj = JSON.stringify({event: "webrtc-failed", userid: messagedata.userid});
				room[messagedata.recipient].socket.send(failedObj);

				break;
			case "relay-put":
				console.log("PEER", messagedata.userid, "SETTING KEY-VALUE PAIR FOR", messagedata.recipient);

				var room = global.signalClients;

				var messageObj = JSON.stringify({event: "relay-put", userid: messagedata.userid, value: messagedata.value, key: messagedata.key, echo: messagedata.echo});
				room[messagedata.recipient].socket.send(messageObj);

				break;
			case "relay-get":
				console.log("PEER", messagedata.userid, "SETTING KEY-VALUE PAIR FOR", messagedata.recipient);

				var room = global.signalClients;

				var messageObj = JSON.stringify({event: "relay-get", userid: messagedata.userid, key: messagedata.key, echo: messagedata.echo, batonholders: messagedata.batonholders});
				room[messagedata.recipient].socket.send(messageObj);

				break;
			case "relay-get-response":
				console.log("PEER", messagedata.userid, "RESPONDING WITH DATA", messagedata.value);

				var room = global.signalClients;

				var messageObj = JSON.stringify({event: "relay-get-response", userid: messagedata.userid, value: messagedata.value, batonholders: messagedata.batonholders});
				room[messagedata.recipient].socket.send(messageObj);

				break;
			case "relay-color":
				console.log("PEER", messagedata.userid, "TRANSMITTING DATA", messagedata.value);

				var room = global.signalClients;

				var messageObj = JSON.stringify({event: "relay-color", userid: messagedata.userid, value: messagedata.value});
				room[messagedata.recipient].socket.send(messageObj);

				break;
		}
	});
});

//listen on port 3000
server.listen(3000);
