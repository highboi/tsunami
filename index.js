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

//a get path for making a room
app.get("/", async (req, res) => {
	return res.redirect(`/${uuidV4()}`);
});

//a get path for a room
app.get("/:roomid", async (req, res) => {
	return res.render("room.ejs", {roomid: req.params.roomid});
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
			case "join-room":
				console.log("JOINING ROOM:", messagedata.roomid);

				//get the room from the signalclients array
				var room = global.signalClients[messagedata.roomid];

				//create the room if it is undefined, and add the user if it is defined
				if (typeof room != 'undefined') {
					room.push({userid: messagedata.userid, socket: ws});
				} else {
					global.signalClients[messagedata.roomid] = [{userid: messagedata.userid, socket: ws}];
					var room = global.signalClients[messagedata.roomid];
				}

				//get all other peers in the room
				var recipients = room.filter((client) => {
					return client.userid != messagedata.userid;
				});

				//notify the other peers of the new user joining the room
				for (var recipient of recipients) {
					var connected = JSON.stringify({event: "user-connected", userid: messagedata.userid});
					recipient.socket.send(connected);
				}

				break;
			case "sdp-offer":
				console.log("SDP OFFER FROM", messagedata.userid);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					//get all other peers in the room
					var recipients = room.filter((client) => {
						return client.userid != messagedata.userid;
					});

					//send the sdp offer to all other peers in the room
					for (var recipient of recipients) {
						var sdpOffer = JSON.stringify({offer: messagedata.offer, event: "sdp-offer", userid: messagedata.userid});
						recipient.socket.send(sdpOffer);
					}
				}
				break;
			case "sdp-answer":
				console.log("SDP ANSWER FROM", messagedata.userid);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					//get the recipient for this message
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					//send the sdp answer to the recipient
					var sdpAnswer = JSON.stringify({answer: messagedata.answer, event: "sdp-answer", userid: messagedata.userid});
					recipients[0].socket.send(sdpAnswer);
				}

				break;
			case "ice-exchange":
				console.log("ICE CANDIDATE FROM", messagedata.userid);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					//get all other peers in the room
					var recipients = room.filter((client) => {
						return client.userid != messagedata.userid;
					});

					//send the ice candidate to all other peers in the room
					for (var recipient of recipients) {
						var iceCandidate = JSON.stringify({event: "ice-exchange", candidate: messagedata.candidate, userid: messagedata.userid});
						recipient.socket.send(iceCandidate);
					}
				}

				break;
			case "answer-pong":
				console.log("ANSWER PONG FROM", messagedata.userid);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					//get the recipient of this answer pong
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					//send the answer pong to the recipient
					var answerPong = JSON.stringify({event: "answer-pong", userid: messagedata.userid});
					recipients[0].socket.send(answerPong);
				}

				break;
			case "get-peers":
				console.log("USER REQUESTING PEERS");

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					//get the user/socket requesting the data
					var recipients = room.filter((client) => {
						return client.userid == messagedata.userid;
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
					recipients[0].socket.send(peersObj);
				}

				break;
			case "webrtc-failed":
				console.log("WEBRTC CONNECTION FAILED FOR", messagedata.userid, "SENDING MESSAGE TO", messagedata.recipient);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					var failedObj = JSON.stringify({event: "webrtc-failed", userid: messagedata.userid});
					recipients[0].socket.send(failedObj);
				}

				break;
			case "relay-put":
				console.log("PEER", messagedata.userid, "SETTING KEY-VALUE PAIR FOR", messagedata.recipient);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					var messageObj = JSON.stringify({event: "relay-put", userid: messagedata.userid, value: messagedata.value, key: messagedata.key});
					recipients[0].socket.send(messageObj);
				}

				break;
			case "relay-get":
				console.log("PEER", messagedata.userid, "SETTING KEY-VALUE PAIR FOR", messagedata.recipient);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					var messageObj = JSON.stringify({event: "relay-get", userid: messagedata.userid, key: messagedata.key});
					recipients[0].socket.send(messageObj);
				}

				break;
			case "relay-get-response":
				console.log("PEER", messagedata.userid, "RESPONDING WITH DATA", messagedata.value);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					var messageObj = JSON.stringify({event: "relay-get-response", userid: messagedata.userid, value: messagedata.value});
					recipients[0].socket.send(messageObj);
				}

				break;
			case "relay-color":
				console.log("PEER", messagedata.userid, "TRANSMITTING DATA", messagedata.value);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					var messageObj = JSON.stringify({event: "relay-color", userid: messagedata.userid, value: messagedata.value});
					recipients[0].socket.send(messageObj);
				}

				break;
		}
	});
});

//listen on port 3000
server.listen(3000);
