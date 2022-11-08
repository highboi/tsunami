//function for initializing the tsunami db
async function tsunami() {
			/*
			SETTING UP OBJECTS TO BE USED IN THE CODE GLOBALLY
			*/

	//the global object to store all tsunami attributes
	var tsunamiDB = {};

	//the text div to put logging information
	var textLog = document.getElementById("text-log");

	//define a unique user id for this instance
	var userid = Math.round(Math.random() * 1000);

	//connect to the signalling server
	var signalSocket = new WebSocket(`ws://${window.location.hostname}:3000/signal`);

	//an array to define peer connections for webrtc
	var connections = {};

	//a variable to listen for the commready event to start data interaction
	var commlistener = document.getElementById("eventlistener");
	commlistener.ready = false;
	commlistener.getdata = {};






			/*
			EVENTS FOR THE SIGNALLING WEBSOCKETS
			*/

	//function executes when the socket opens
	signalSocket.onopen = async (event) => {
		//send the current room id and user id to the server
		var data = JSON.stringify({roomid: roomid, userid: userid, event: "join-room"});
		signalSocket.send(data);

		//get the amount of peers needed to connect to
		var getPeers = JSON.stringify({event: "get-peers", userid: userid, roomid: roomid});
		signalSocket.send(getPeers);
	};

	//function executes when the socket recieves a message
	signalSocket.onmessage = async (event) => {
		//parse the data as a json object
		var data = JSON.parse(event.data);

		//do something based on the corresponding event
		switch (data.event) {
			case "user-connected": //a new peer joined the network
				textLog.innerHTML += "PEER JOINED ROOM<br>";

				break;
			case "get-peers": //make new connections for each peer
				//log this event
				textLog.innerHTML += "GETTING PEERS<br>";

				//make a new connection for each peer currently on the network
				for (var peer of data.peers) {
					connections[peer] = await makeNewConnection(peer);
					await sendOffer(connections[peer]);
				}

				break;
			case "sdp-offer": //set the remote description and create/send an answer to the client
				//log this event
				textLog.innerHTML += "SDP OFFER FROM PEER<br>";

				if (typeof connections[data.userid] == 'undefined') {
					connections[data.userid] = await makeNewConnection(data.userid);
				}

				//set the remote description for this connection
				await connections[data.userid].connection.setRemoteDescription(new RTCSessionDescription(data.offer));

				try {
					//make an sdp answer and set it as the local description
					var answer = await connections[data.userid].connection.createAnswer();
					await connections[data.userid].connection.setLocalDescription(answer);
				} catch (e) {
					textLog.innerHTML += JSON.stringify(e);
				}

				//send the sdp answer to the peer
				var answerObj = JSON.stringify({recipient: data.userid, userid: userid, answer: answer, event: "sdp-answer", roomid: roomid});
				signalSocket.send(answerObj);

				break;
			case "sdp-answer": //set the answer as the remote description and send an answer pong
				//log this event
				textLog.innerHTML += "SDP ANSWER FROM PEER<br>";

				//make a new connection if the connection is not defined
				if (typeof connections[data.userid] == 'undefined') {
					connections[data.userid] = await makeNewConnection(data.userid);
				}

				//set the remote description to be the answer sent by the peer
				//connections[data.userid].connection.setRemoteDescription(new RTCSessionDescription(data.answer));

				//store the sdp answer in the connection object
				connections[data.userid].sdpAnswer = data.answer;

				//add the ice candidates to this connection
				await addCandidates(connections[data.userid]);

				//send the answer pong to the other side
				var answerPong = JSON.stringify({event: "answer-pong", userid: userid, roomid: roomid, recipient: data.userid});
				signalSocket.send(answerPong);

				break;
			case "ice-exchange": //cache ice candidates in the corresponding connections
				//log this event
				textLog.innerHTML += "RECIEVED ICE CANDIDATE FROM PEER<br>";

				//cache this ice candidate in the corresponding connection object
				connections[data.userid].iceCandidates.push(data.candidate);

				break;
			case "answer-pong": //attach cached ice candidates to the corresponding connection
				//log this event
				textLog.innerHTML += "RECIEVED ANSWER PONG FROM PEER<br>"

				//add the ice candidates to this connection
				await addCandidates(connections[data.userid]);

				break;
			case "webrtc-failed":
				//log this event
				textLog.innerHTML += "***<br>PEERS FAILED TO CONNECT, DEFAULTING TO HTTP RELAY<br>***<br>";

				//set the communication as the signal socket since http relay will be used
				connections[data.userid].connection.commchannel = signalSocket;

				//make a new event to initiate communication
				var commEvent = new Event("commready");

				//fire the commready event
				connections[data.userid].connection.dispatchEvent(commEvent);
				if (!commlistener.ready) {
					commlistener.dispatchEvent(commEvent);
					commlistener.ready = true;
				}

				break;
			case "relay-get":
				//log this event
				textLog.innerHTML += "PEER " + data.userid.toString() + " IS REQUESTING DATA WITH KEY " + data.key.toString() + "<br>";

				//get the data from local storage
				var value = getLocalData(data.key);

				//send the data if it is not a null value
				if (value != null) {
					var valueObj = JSON.stringify({userid: userid, roomid: roomid, event: "relay-get-response", key: data.key, value: value, recipient: data.userid});
					connections[data.userid].connection.commchannel.send(valueObj);
				}

				break;
			case "relay-put":
				//log this event
				textLog.innerHTML += "PEER " + data.userid.toString() + " IS SETTING A KEY-VALUE PAIR: " + data.key.toString() + ":"  + JSON.stringify(data.value) + "<br>";

				//store the data in local storage
				storeLocalData(data.key, data.value);

				break;

			case "relay-get-response":
				//log this event
				textLog.innerHTML += "PEER " + data.userid.toString() + " RESPONDED TO GET WITH DATA: " + JSON.stringify(data.value) + "<br>";

				//store the data requested in local storage
				storeLocalData(data.key, data.value);

				//fire this event for the getdata function to return data
				var getResEvent = new Event("relay-get-response");
				commlistener.getdata[data.key] = data.value;
				commlistener.dispatchEvent(getResEvent);

				break;
			case "relay-color":
				//log this event
				textLog.innerHTML += "PEER " + data.userid.toString() + " IS TRANSMITTING DATA: " + JSON.stringify(data.value) + "<br>";

				document.getElementById("color-box").style.backgroundColor = data.value;

				break;
		}
	}

	//make a function to listen for events on a webrtc data channel instead of a socket channel
	async function rtcChannelOnMessage(event) {
		var data = JSON.parse(event.data);

		switch (data.event) {
			case "relay-get":
				//log this event
				textLog.innerHTML += "PEER " + data.userid.toString() + " IS REQUESTING DATA WITH KEY " + data.key.toString();

				//get the data from local storage
				var value = getLocalData(data.key);

				//send the data if it is not a null value
				if (value != null) {
					var valueObj = JSON.stringify({userid: userid, roomid: roomid, event: "relay-get-response", key: data.key, value: value, recipient: data.userid});
					connections[data.userid].connection.commchannel.send(valueObj);
				}

				break;
			case "relay-put":
				//log this event
				textLog.innerHTML += "PEER " + data.userid.toString() + " IS SETTING A KEY-VALUE PAIR: " + data.key.toString() + ":"  + JSON.stringify(data.value);

				//store the data in local storage
				storeLocalData(data.key, data.value);

				break;
			case "relay-get-response":
				//log this event
				textLog.innerHTML += "PEER " + data.userid.toString + " RESPONDED TO GET WITH DATA: " + JSON.stringify(messagedata.value);

				//store the data requested in local storage
				storeLocalData(data.key, data.value);

				//fire this event for the getdata function to return data
				var getResEvent = new Event("relay-get-response");
				commlistener.getdata[data.key] = data.value;
				commlistener.dispatchEvent(getResEvent);

				break;
			case "relay-color":
				//log this event
				textLog.innerHTML += "PEER " + data.userid.toString() + " IS TRANSMITTING DATA: " + JSON.stringify(data.value) + "<br>";

				document.getElementById("color-box").style.backgroundColor = data.value;

				break;
		}
	}






			/*
			WEBRTC FUNCTIONS
			*/

	//configuration with which stun/turn servers to use with webrtc
	var conf = {'iceServers': [{'urls': ['stun:stun.l.google.com:19302']}]};

	//a function to make a new connection object
	async function makeNewConnection(peerid) {
		//make a new object to describe a peer connection
		var newConnection = {
			connection: new RTCPeerConnection(conf),
			sdpOffer: "",
			sdpAnswer: "",
			iceCandidates: []
		}

		//store the peer id in the new connection
		newConnection.connection.peerid = peerid;

		//store the connection readiness in the connection
		newConnection.connection.ready = false;

		//wait for the connection to the peer to be established
		newConnection.connection.oniceconnectionstatechange = (event) => {
			if (event.target.iceConnectionState == "connected") {
				//log this event
				textLog.innerHTML += "***<br>PEERS CONNECTED<br>***<br>";

				//listen for data from peers
				newConnection.connection.commchannel.onmessage = rtcChannelOnMessage;

				//make a new event to initiate communication
				var commEvent = new Event("commready");

				//fire the commready event
				event.target.dispatchEvent(commEvent);
				if (!commlistener.ready) {
					commlistener.dispatchEvent(commEvent);
					commlistener.ready = true;
				}
			} else if (event.target.iceConnectionState == "failed") {
				//log this event
				textLog.innerHTML += "***<br>PEERS FAILED TO CONNECT, DEFAULTING TO HTTP RELAY<br>***<br>";

				//notify the peer that the connection failed
				var failedObj = JSON.stringify({event: "webrtc-failed", roomid: roomid, userid: userid, recipient: event.target.peerid});
				signalSocket.send(failedObj);

				//set the signal socket as the communication channel instead of the webrtc channel
				event.target.commchannel = signalSocket;

				//make a new event to initiate communication
				var commEvent = new Event("commready");

				//fire the commready event
				event.target.dispatchEvent(commEvent);
				if (!commlistener.ready) {
					commlistener.dispatchEvent(commEvent);
					commlistener.ready = true;
				}
			}
		};

		//listen for when communication is ready
		newConnection.connection.addEventListener("commready", (event) => {
			//log this event in the console
			textLog.innerHTML += "COMMUNICATION CAN COMMENCE WITH PEER " + event.target.peerid.toString() + "<br>";

			//set the connection to be ready
			newConnection.connection.ready = true;
		});

		//listen for ice candidates being generated
		newConnection.connection.onicecandidate = (event) => {
			textLog.innerHTML += "SENDING ICE CANDIDATE<br>"

			//make an object containing the ice candidate
			var candidate = JSON.stringify({candidate: event.candidate, userid: userid, roomid: roomid, event: "ice-exchange"});

			//send the ice candidate to the server
			signalSocket.send(candidate);
		};

		//make a data channel for this connection using webrtc
		newConnection.connection.commchannel = newConnection.connection.createDataChannel("tsunami", {ordered: true});

		return newConnection;
	}

	//create an sdp offer and send it to the signalling server
	async function sendOffer(connectionObj) {
		//get the webrtc connection object
		var connection = connectionObj.connection;

		//make an sdp offer with this peer connection
		var offer = await connection.createOffer();
		await connection.setLocalDescription(offer);
		await connection.setRemoteDescription(offer);

		//store the sdp offer in the connection object
		connectionObj.sdpOffer = offer;

		//package the sdp offer and room id into an object and send to the signalling server
		var sdpObject = JSON.stringify({offer: offer, roomid: roomid, event: "sdp-offer", userid: userid});
		signalSocket.send(sdpObject);
	}

	//a function for adding ice candidates to a connection
	async function addCandidates(connectionObj) {
		//attach cached ice candidates to the corresponding connection
		for (var icecandidate of connectionObj.iceCandidates) {
			//catch errors with adding ice candidates
			try {
				if (icecandidate != null && icecandidate != "") {
					//log the addition of ice candidates
					textLog.innerHTML += "ADDING ICE CANDIDATE FROM PEER<br>";

					//make a new candidate object to avoid browser compatibility problems
					var newCandidate = new RTCIceCandidate({
						sdpMLineIndex: icecandidate.sdpMLineIndex,
						candidate: icecandidate
					});

					//add the new ice candidate to the connection
					await connectionObj.connection.addIceCandidate(newCandidate);
				}
			} catch (e) {
				//log this error
				textLog.innerHTML += "ERROR ADDING ICE CANDIDATE<br>";

				//log the error in the console for debugging
				console.log("ERROR WITH ICE CANDIDATE");
				console.log(e);
			}
		}
	}






			/*
			LOCAL DATA HANDLING FUNCTIONS
			*/

	//a function for broadcasting arbitrary data (custom protocol
	async function broadcastData(data) {
		var peers = Object.values(connections).filter((peer) => {
			return peer.connection.ready;
		});

		var dataObj = {event: "relay-color", value: data, roomid: roomid, userid: userid};

		//send data to all peers ready to recieve data
		for (var peer of peers) {
			//set the recipient for this message and send it on the comm channel
			dataObj.recipient = peer.connection.peerid;
			peer.connection.commchannel.send(JSON.stringify(dataObj));
		}
	}

	//a function for broadcasting a key-value pair to all peers for syncing
	async function putData(key, data) {
		//store this data locally first for efficiency
		localStorage.setItem(key, JSON.stringify(data));

		//get peers that are ready to recieve data
		var peers = Object.values(connections).filter((peer) => {
			return peer.connection.ready;
		});

		//the data object to send to all peers
		var dataObj = {key: key, value: data, userid: userid, roomid: roomid, event: "relay-put"};

		//send data to all peers ready to recieve data
		for (var peer of peers) {
			//set the recipient for this message and send it on the comm channel
			dataObj.recipient = peer.connection.peerid;
			peer.connection.commchannel.send(JSON.stringify(dataObj));
		}

		//return the sent data for reference
		return dataObj;
	}

	//a function for broadcasting a get message to get data from peers if available
	async function getData(key) {
		//get local data first before requesting peers
		var localdata = getLocalData(key);
		if (localdata != null) {
			return localdata;
		}

		//get peers that are ready to recieve data
		var peers = Object.values(connections).filter((peer) => {
			return peer.connection.ready;
		});

		//the data object to send to all peers
		var dataObj = {key: key, userid: userid, roomid: roomid, event: "relay-get"};

		//send data to all peers ready to recieve data
		for (var peer of peers) {
			//set the recipient for this message and send it on the comm channel
			dataObj.recipient = peer.connection.peerid;
			peer.connection.commchannel.send(JSON.stringify(dataObj));
		}

		//return a promise that resolves when data is returned by a peer
		return new Promise((resolve, reject) => {
			commlistener.addEventListener("relay-get-response", (event) => {
				resolve(event.target.getdata[key]);
			});
		});
	}

	//a function to store data in local storage
	function storeLocalData(key, value) {
		//store the key value pair
		localStorage.setItem(key, JSON.stringify(value));

		//return the key value pair
		return [key, value];
	}

	//a function to get data from local storage
	function getLocalData(key) {
		//get the value of the data and return false if it does not exist
		try {
			var data = localStorage.getItem(key);
		} catch (e) {
			return null;
		}

		//try to parse the value returned and return the string if it cannot be parsed
		try {
			data = JSON.parse(data);
			return data;
		} catch (e) {
			return data;
		}
	}

	//a function for torrenting a file with a unique id
	async function torrentFile(file, id) {
		//get the raw data from the file
		var fileBuffer = await file.arrayBuffer();
		var buffer = new Uint8Array(fileBuffer);

		//divide the file data into fragments and store into an array
		var fragments = [];
		for (var byteindex = 0; byteindex < buffer.length; byteindex += 100) {
			//make a fragment object with the position, data, and associated url to be put into the fragments array
			var fragment = buffer.slice(byteindex, byteindex+100);
			fragments.push(fragment);
		}

		//get the order of each fragment for later reassembly
		var positions = [];
		for (var frag in fragments) {
			//store the fragment on the network
			var fragment_key = frag + "_" + id;
			await putData(fragment_key, fragments[frag]);

			//add this fragment key to the positions array
			positions.push(fragment_key);
		}

		//make a fragment ledger to store all fragment keys/ids
		var ledger_key = id + "_ledger";
		await putData(ledger_key, {positions: positions, filetype: filetype});

		return true;
	}

	//a function for downloading a torrent from the network with a unique id
	async function downloadTorrent(id) {
		//get the ledger for all the file fragments
		var ledger_key = id + "_ledger";
		var ledger = await getData(ledger_key);

		//get file fragments from the network
		var fragments = [];
		for (var position of ledger.positions) {
			var fragment = await getData(position);
			fragments.push(fragment);
		}

		//turn fragments into bytes of raw data
		var bytes = [];
		for (var fragment of fragments) {
			for (var byte of Object.values(fragment)) {
				bytes.push(byte);
			}
		}

		//convert the byte array into a blob
		var buffer = Uint8Array.from(bytes);
		var blob = new Blob([buffer], {
			type: ledger.filetype
		});

		//make a blob url
		var fileurl = URL.createObjectURL(blob);

		//return the url for use on the webpage
		return fileurl;
	}

	//listen for the commready event to start interacting with data
	commlistener.addEventListener("commready", (event) => {
		alert("DATA INTERACTION IS READY");

		putData("KEYEXAMPLE", {example: "data"});

		//generate a random color and send it to the other user
		document.getElementById("random-color").addEventListener("click", async (event) => {
			var red = Math.random() * 255;
			var green = Math.random() * 255;
			var blue = Math.random() * 255;

			var color = `rgb(${red}, ${green}, ${blue})`;
			document.getElementById("color-box").style.backgroundColor = color;

			await broadcastData(color);
		});
	});
}

(async () => {
	await tsunami();
})();