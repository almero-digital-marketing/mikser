'use strict'

let WebSocketServer = require('ws').Server;
let Promise = require('bluebird');
let cluster = require('cluster');
let net = require('net');
let chalk = require('chalk');

module.exports = function (mikser) {
	let debug = mikser.debug('feedback');
	let feedback = {
		server: {
			broadcast: () => {}
		}
	}

	if (cluster.isMaster) {
		if (mikser.config.feedback === false) {
			console.log('Feedback is disabled');
			return Promise.resolve();
		}

		mikser.config.browser.push('feedback');
		mikser.cleanup.push(() => {
			if (feedback.server) {
				debug('Closing web socket server');
				let closeAsync = Promise.promisify(feedback.server.close, { context: feedback.server });
				return closeAsync().catch((err) => {
					debug('Closing server failed:', err);
				});
			}
			return Promise.resolve();
		});

		mikser.on('mikser.server.ready', () => {
			feedback.server = new WebSocketServer({ port: mikser.config.feedbackPort });

			feedback.server.broadcast = function broadcast(data) {
				if (typeof data !== 'string') {
					data = JSON.stringify(data);
				}

				feedback.server.clients.forEach(function each(client) {
					client.send(data, (err) => {
						if (err) {
							debug('Send failed:', err);
						}
					});
				});
			}

			feedback.server.on('connection', (socket) => {
				debug('New feedback connection established');

				socket.on('close', (code, message) => {
					debug(`Feedback disconnected.Code: ${code}`, message);
				});
			});
		});

		mikser.on('mikser.scheduler.renderStarted', () => {
			console.log(chalk.bgCyan.bold('Started'));
			return feedback.server.broadcast({
				message: 'render-started'
			});
		});

		mikser.on('mikser.diagnostics.progress', (progress) => {
			if (feedback.server) {
				let message = {
					message: progress,
					level: 'progress'
				}
				debug('Handling progress event');
				return feedback.server.broadcast(message);
			}
		});

		mikser.on('mikser.scheduler.renderFinished', () => {
			console.log(chalk.bgGreen.bold('Finished'));
			return feedback.server.broadcast({
				message: 'render-finished'
			});
		});

	}


	mikser.on('mikser.diagnostics.log', (log) => {
		if (log.level !== 'info') {
			let data = { message: log.message, level: log.level };
			if (log.document) data.documentId = log.document._id;
			if (log.layout) data.layoutId = log.layout._id;
			debug('Broadcasting log:', data);

			if (cluster.isMaster && feedback.server) {
				return feedback.server.broadcast(data);
			} else if(cluster.isWorker) {
				return mikser.broker.call('mikser.plugins.feedback.server.broadcast', data);
			}
		}
	});


	if (cluster.isWorker) {
		return Promise.resolve();
	} else {
		return mikser.utils.resolvePort(mikser.config.feedbackPort, 'feedback').then((port) => {
			let feedbackPort = mikser.config.feedbackPort;
			if (feedbackPort && feedbackPort !== port) {
				mikser.diagnostics.log('warning', `Feedback config port: ${feedbackPort} is already in use, resolved with ${port}`);
			}
			mikser.config.feedbackPort = port;
			debug('Port:', port);
			return Promise.resolve(feedback);
		});
	}

}