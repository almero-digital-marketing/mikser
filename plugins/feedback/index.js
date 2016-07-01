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

		mikser.on('mikser.server.listen', (app) => {
			app.ws('/feedback', function(socket, req) {
				debug('New feedback connection established');
				// send diagnostics history 
				if (feedback.history.length > 0) {
					let data = {
						history: feedback.history,
						finished: feedback.finished,
						level: 'history',
						source: 'diagnostics'
					}
					socket.send(JSON.stringify(data), (err) => {
						if (err) debug(`Error sending data: ${err}`);
					});
				}
				// send tools history
				if (Object.keys(feedback.commands).length > 0 && feedback.commands.constructor === Object) {
					let data = {
						history: Object.keys(feedback.commands).map((command) => {
							return {
								command: command,
								message: feedback.commands[command].message,
								code: feedback.commands[command].code
							};
						}),
						source: 'tools'
					}

					socket.send(JSON.stringify(data), (err) => {
						if (err) debug(`Error sending data: ${err}`);
					});
				}

				socket.on('close', (code, message) => {
					debug(`Feedback disconnected. Code: ${code}`, message);
				});
			});
			feedback.server = mikser.server.ws.getWss('/feedback');
			feedback.server.broadcast = function broadcast(data) {
				if (typeof data !== 'string') {
					// gather errors and warnings from diagnostics module
					if (data.source === 'diagnostics' && (data.level === 'error' || data.level === 'warning')) {
						feedback.history.push(data);
					}
					data = JSON.stringify(data);
				}

				feedback.server.clients.forEach(function each(client) {
					client.send(data, (err) => {
						if (err) debug('Send failed:', err);
					});
				});
			}
		});

		mikser.on('mikser.scheduler.renderStarted', () => {
			debug('Started');
			feedback.history.splice(0, feedback.finishedPointer);
			feedback.finishedPointer = 0;
			feedback.finished = false;
			feedback.server.broadcast({
				status: 'started',
				source: 'scheduler'
			});
		});

		mikser.on('mikser.diagnostics.progress', (progress) => {
			if (feedback.server) {
				debug('Handling progress event');
				feedback.server.broadcast({
					message: progress,
					status: 'progress',
					source: 'queue'
				});
			}
		});

		mikser.on('mikser.scheduler.renderFinished', () => {
			debug('Finished');
			feedback.finishedPointer = feedback.history.length;
			feedback.finished = true;
			feedback.server.broadcast({
				status: 'finished',
				source: 'scheduler'
			});
		});

		mikser.on('mikser.tools.run.start', (event) => {
			delete feedback.commands[event.command];
		});

		mikser.on('mikser.tools.run', (event) => {
			if (!feedback.commands[event.command]) {
				feedback.commands[event.command] = { message: '' };
			}
			let command = feedback.commands[event.command];
			if (event.message) command.message += event.message + '\n';
		});

		mikser.on('mikser.tools.run.finish', (event) => {
			feedback.commands[event.command] = feedback.commands[event.command] || {}
			feedback.commands[event.command].code = event.code;

			feedback.server.broadcast({
				code: event.code,
				command: event.command,
				message: feedback.commands[event.command].message,
				source: 'tools'
			});
		});

	}

	mikser.on('mikser.diagnostics.log', (log) => {
		if (log.level !== 'info') {
			debug('Broadcasting log:', log);
			log.message = stripAnsi(log.message);
			log.source = 'diagnostics';
			
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
		return Promise.resolve(feedback);
	}

}