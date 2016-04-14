'use strict'

let WebSocketServer = require('ws').Server;
let Promise = require('bluebird');
let cluster = require('cluster');
let net = require('net');

module.exports = function (mikser) {
	if (cluster.isWorker) return;

	if (mikser.config.feedback === false) {
		console.log('Feedback information is disabled');
		return Promise.resolve();
	}

	mikser.config.browser.push('feedback');
	let debug = mikser.debug('feedback');
	let feedback = {
		clients: {}
	}
	let lastClientId = 0;

	feedback.sendProgress = function(message) {
		debug('In sendProgress');
		if (feedback.server) {
			debug('Sending progress message', message)
			for(let clientId in feedback.clients) {
				let client = feedback.clients[clientId];
				client.socket.send(message, (err) => {
					if (err) {
						if (feedback.clients[clientId]) {
							debug('Feedback stopped:', err);
							delete feedback.clients[clientId];
						}
					}
				});
			}
		}
		return Promise.resolve();
	}

	mikser.cleanup.push(() => {
		if (feedback.server) {
			let closeAsync = Promise.promisify(feedback.server.close, { context: feedback.server });
			return closeAsync().catch((err) => {
				for(let clientId in feedback.clients) {
					let client = feedback.clients[clientId];
					client.socket.destroy();
				}
			});
		}
		return Promise.resolve();
	});

	mikser.on('mikser.server.ready', () => {
		feedback.server = new WebSocketServer({ port: mikser.config.feedbackPort });
		feedback.server.on('connection', (socket) => {
			debug('New feedback connection established');
			let clientId = lastClientId++;
			feedback.clients[clientId] = {
				socket: socket
			};

			socket.on('close', (socket) => {
				if(feedback.clients[clientId]) {
					debug('Feedback connection is closed.');
					delete feedback.clients[clientId];
				}
			});

		});
	});

	mikser.on('mikser.diagnostics.progress', (message) => {
		debug('Handling progress event');
		return feedback.sendProgress(message);
	});


	if (!mikser.config.feedbackPort) {
		let freeport = new Promise((resolve, reject) => {
			var server = net.createServer();
			server.listen(0, '127.0.0.1', () => {
				let port = server.address().port;
				server.close(() => {
					resolve(port);
				});
			});
		});
		return freeport.then((port) => {
			mikser.config.feedbackPort = port
		});
	}

	return Promise.resolve(feedback);
}