'use strict'

let WebSocketServer = require('ws').Server;
let Promise = require('bluebird');
let cluster = require('cluster');
let net = require('net');
let chalk = require('chalk');
let stripAnsi = require('strip-ansi');
let util = require('util');

module.exports = function (mikser) {

	let debug = mikser.debug('feedback');
	let feedback = {
		server: {
			broadcast: (data) => {
				console.log('Initial broadcast method');
				if (typeof data !== 'string') {
					data.message = stripAnsi(data.message);
					if (data.level === 'error' || data.level === 'warning') {
						feedback.history.push(data);
					}
				}
			}
		},
		history: [],
		finishedPointer: 0,
		finished: false,
		commands: {}
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
					if (data.level === 'error' || data.level === 'warning') {
						feedback.history.push(data);
					}
					// console.log('Sending to clients', JSON.stringify(data, null, 4));
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
				if (feedback.history.length > 0) {
					let data = {
						history: feedback.history,
						finished: feedback.finished,
						level: 'history'
					}
					socket.send(JSON.stringify(data), (err) => {
						debug(`Error sending data: ${err}`);
					});
				}

				if (Object.keys(feedback.commands).length > 0 && feedback.commands.constructor === Object) {
					let data = {
						history: Object.keys(feedback.commands).map((command) => {
							return { command: command, message: feedback.commands[command].message };
						}),
						isRunEvent: true
					}

					socket.send(JSON.stringify(data), (err) => {
						debug(`Error sending data: ${err}`);
					});
				}

				socket.on('close', (code, message) => {
					debug(`Feedback disconnected.Code: ${code}`, message);
				});
			});
		});

		mikser.on('mikser.scheduler.renderStarted', () => {
			debug('Started');
			// clear feedback history
			feedback.history.splice(0, feedback.finishedPointer);
			feedback.finishedPointer = 0;
			feedback.finished = false;
			feedback.server.broadcast({
				status: 'started'
			});
		});

		mikser.on('mikser.diagnostics.progress', (progress) => {
			if (feedback.server) {
				debug('Handling progress event');
				feedback.server.broadcast({
					message: progress,
					status: 'progress'
				});
			}
		});

		mikser.on('mikser.scheduler.renderFinished', () => {
			debug('Finished');
			feedback.finishedPointer = feedback.history.length;
			feedback.finished = true;
			feedback.server.broadcast({
				status: 'finished'
			});
		});

		mikser.on('mikser.tools.run.start', (event) => {
			delete feedback.commands[event.command];
		});

		mikser.on('mikser.tools.run', (log) => {
			if (!feedback.commands[log.command]) {
				feedback.commands[log.command] = { message: '' };
			}
			let command = feedback.commands[log.command];
			command.isRunEvent = true;
			if (log.message) command.message += log.message + '\n';
		});

		mikser.on('mikser.tools.run.finish', (event) => {
			console.log(event.command, event.code, 'Yep something is happening');
			feedback.commands[event.command].code = event.code;
			feedback.server.broadcast(feedback.commands[event.command]);
		});

	}

	mikser.on('mikser.diagnostics.log', (log) => {
		if (log.level !== 'info') {
			debug('Broadcasting log:', log);
			log.message = stripAnsi(log.message);
			
			if (cluster.isMaster && feedback.server) {
				feedback.server.broadcast(log);
			} else if(cluster.isWorker) {
				mikser.broker.call('mikser.plugins.feedback.server.broadcast', log);
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