'use strict'

var Promise = require('bluebird');
var cluster = require('cluster');
var _ = require('lodash');
var guid = require('guid');
var extend = require('node.extend');
var yaml = require('js-yaml');

module.exports = function(mikser) {
	let broker = {
		pending: {},
		pendingInfo: {}
	};

	function apply(message) {
		let call;
		for (let section of message.call.split('.')) {
			if (section == 'mikser') {
				call = mikser;
			} else {
				call = call[section];
			}
		}
		try {
			let result = call.apply(null, message.args);
			if (result && 'catch' in result) {
				return result.catch((err) => {
					message.err = err.message;
					if (err.stack) message.err = err.stack.toString();
				});
			}
			return Promise.resolve(result);
		} catch (err) {
			message.err = err.message;
			if (err.stack) message.err = err.stack.toString();
		}
		return Promise.resolve();
	}

	function receive(message, worker) {
		if (message._id) {
			if (broker.pending[message._id]) {
				// This is the answer of already sent message
				broker.pending[message._id](message);
				if (mikser.options.debug) delete broker.pendingInfo[message._id];
				delete broker.pending[message._id];
			} else {
				let dispatch = Promise.resolve();
				if (message.broadcast) {
					let relayMessage = extend({}, message);
					delete relayMessage.broadcast;
					let others = mikser.workers.filter((element, index) => index != relayMessage.workerId);
					dispatch = send(relayMessage, others);
				}
				dispatch.then((values) => {
					return apply(message).then((value) => {
						if (values) {
							values.push(value);
							message.value = values;
						} else {
							message.value = value;
						}
						if (worker) {
							worker.send(message);
						} else {
							process.send(message);
						}						
					});					
				});
			}
		} 
	}

	function send(message, workers) {
		if (cluster.isMaster) {
			workers = workers || mikser.workers;
			if (!workers) return Promise.resolve();
		} else {
			message.workerId = mikser.workerId;
		}
		if (workers) {
			return Promise.map(workers, (worker) => {
				return new Promise((resolve, reject) => {
					message._id = guid.raw();
					if (mikser.options.debug) broker.pendingInfo[message._id] = message.call;
					broker.pending[message._id] = (message) => {
						if (message.err) reject(message.err);
						else resolve(message.value);
					}
					worker.send(message);
				});
			});
		} else {
			return new Promise((resolve, reject) => {
				message._id = guid.raw();
				if (mikser.options.debug) broker.pendingInfo[message._id] = message;
				broker.pending[message._id] = (message) => {
					if (message.err) reject(message.err);
					else resolve(message.value);
				}
				process.send(message);
			});
		}
	}

	broker.broadcast = function() {
		let args = Array.from(arguments);
		let call = args.shift();
		let message = {
			call: call,
			args: args
		}
		return apply(message).then((value) => {
			if (cluster.isMaster) {
				var action = send(message, mikser.workers)
			} else {
				message.broadcast = true;
				var action = send(message);
			}
			return action.then((values) => {
				if (values) {
					values.unshift(value);
				}
				return Promise.resolve(values);
			});
		});
	}

	broker.call = function() {
		let args = Array.from(arguments);
		let call = args.shift();
		if (cluster.isMaster) {
			if (args[0] instanceof cluster.Worker) {
				var workers = [args.shift()];
			} else {
				throw 'Worker is undefined';
			}
		}
		let message = {
			call: call,
			args: args
		}
		return send(message, workers);
	}

	if (cluster.isMaster) {
		mikser.on('mikser.workersInitialized', () => {
			for (let worker of mikser.workers) {
				worker.on('message', (message) => receive(message, worker));	
			}
		});
	} else {
		process.on('message', receive);
	}

	mikser.on('mikser.stoppingWorkers', () => {
		if (_.keys(mikser.broker.pending).length) {
			if (mikser.options.debug) {
				console.log(yaml.dump(mikser.broker.pendingInfo));
				mikser.broker.pendingInfo = {}
			}
			mikser.broker.pending = {};
			throw 'Pending messages in broker';
		}
	});

	mikser.broker = broker;
	return Promise.resolve(mikser);
}