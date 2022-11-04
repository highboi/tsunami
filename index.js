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

			console.log(req.connection.remoteAddress);

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

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					room.push({userid: messagedata.userid, socket: ws});
				} else {
					global.signalClients[messagedata.roomid] = [{userid: messagedata.userid, socket: ws}];
					var room = global.signalClients[messagedata.roomid];
				}

				for (var client of room) {
					if (client.userid != messagedata.userid) {
						var connected = JSON.stringify({event: "user-connected", userid: messagedata.userid});
						client.socket.send(connected);
					}
				}
				break;
			case "sdp-offer":
				console.log("SDP OFFER FROM", messagedata.userid);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					for (var client of room) {
						if (client.userid != messagedata.userid) {
							var sdpOffer = JSON.stringify({offer: messagedata.offer, event: "sdp-offer", userid: messagedata.userid});
							client.socket.send(sdpOffer);
						}
					}
				}
				break;
			case "sdp-answer":
				console.log("SDP ANSWER FROM", messagedata.userid);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					var sdpAnswer = JSON.stringify({answer: messagedata.answer, event: "sdp-answer", userid: messagedata.userid});
					recipients[0].socket.send(sdpAnswer);
				}

				break;
			case "ice-exchange":
				console.log("ICE CANDIDATE FROM", messagedata.userid);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid != messagedata.userid;
					});

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
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					console.log(recipients);

					var answerPong = JSON.stringify({event: "answer-pong", userid: messagedata.userid});
					recipients[0].socket.send(answerPong);
				}

				break;
			case "get-peers":
				console.log("USER REQUESTING PEERS");

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid == messagedata.userid;
					});

					var peers = room.filter((client) => {
						return client.userid != messagedata.userid;
					});

					var peerids = peers.map((peer) => {
						return peer.userid;
					});

					console.log(peerids);

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
			case "relay-message":
				console.log("PEER", messagedata.userid, "SENDING MESSAGE TO", messagedata.recipient);

				var room = global.signalClients[messagedata.roomid];

				if (typeof room != 'undefined') {
					var recipients = room.filter((client) => {
						return client.userid == messagedata.recipient;
					});

					var messageObj = JSON.stringify({event: "relay-message", userid: messagedata.userid, data: messagedata.data});
					recipients[0].socket.send(messageObj);
				}

				break;
		}
	});
});

//listen on port 3000
server.listen(3000);
