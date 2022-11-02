/*
SETTING UP OBJECTS TO BE USED IN THE CODE
*/

//an array to define peers connected
var peersList = [];

//define a unique user id for this instance
var userid = crypto.randomUUID();

//connect to the signalling server
var signalSocket = new WebSocket("ws://localhost:3000/signal");

//configuration with which stun/turn servers to use
var conf = {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]};

//make a new webrtc connection
var peerConnection = new RTCPeerConnection(conf);

/*
EVENTS FOR THE SIGNALLING WEBSOCKETS
*/

//function executes when the socket opens
signalSocket.onopen = (event) => {
	//send the current room id and user id to the server
	var data = JSON.stringify({roomid: roomid, userid: userid, event: "join-room"});
	signalSocket.send(data);

	//send the sdp offer to the signalling server
	sendOffer();
};

//function executes when the socket recieves a message
signalSocket.onmessage = async (event) => {
	var data = JSON.parse(event.data);

	switch (data.event) {
		case "sdp-offer":
			peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

			var answer = await peerConnection.createAnswer();

			await peerConnection.setLocalDescription(answer);

			var answerObj = JSON.stringify({recipient: data.userid, userid: userid, answer: answer, event: "sdp-answer", roomid: roomid});

			signalSocket.send(answerObj);

			peersList.push(data.userid);

			break;
		case "sdp-answer":
			await peerConnection.setRemoteDescription(data.answer);

			break;
		case "ice-exchange":
			try {
				await peerConnection.addIceCandidate(data.candidate);
			} catch (e) {
				console.log(e);

				alert("ERROR WITH ICE CANDIDATE");
			}

			break;
	}
}

/*
WEBRTC SETUP
*/

//make a data channel
var tsunamiChannel = peerConnection.createDataChannel("tsunami");

//listen for ice candidates being generated
peerConnection.onicecandidate = (event) => {
	//make an object containing the ice candidate
	var candidate = JSON.stringify({candidate: event.candidate, userid: userid, roomid: roomid, event: "ice-exchange"});

	//send the ice candidate to the server
	signalSocket.send(candidate);
};

//create an sdp offer and send it to the signalling server
async function sendOffer() {
	//make an sdp offer with this peer connection
	var offer = await peerConnection.createOffer();
	await peerConnection.setLocalDescription(offer);

	//package the sdp offer and room id into an object and send to the signalling server
	var sdpObject = JSON.stringify({offer: offer, roomid: roomid, event: "sdp-offer", userid: userid});
	signalSocket.send(sdpObject);
}

//wait for the connection to the peer to be established
peerConnection.onconnectionstatechange = (event) => {
	alert(peerConnection.connectionState);

	if (peerConnection.connectionState == "connected") {
		alert("PEERS CONNECTED YAY");

		tsunamiChannel.send("CONNECTED YAY");
	}
};

/*
EVENTS FOR THE WEBRTC DATA CHANNEL
*/

//listen for data from peers
tsunamiChannel.onmessage = (event) => {
	console.log(event);

	alert("MESSAGE SENT FROM PEER");
};

//catch errors with the data channel
tsunamiChannel.onerror = (error) => {
	console.log(error);

	alert("ERROR ON DATA CHANNEL");
};
