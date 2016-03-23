'use strict'

var Promise = require('bluebird');
var cluster = require('cluster');
var _ = require('lodash');
var uuid = require('uuid');
var extend = require('node.extend');
var yaml = require('js-yaml');

module.exports = function(mikser) {
	let broker = {
		pending: {},
		pendingInfo: {}
	};
	var debug = mikser.debug('broker');


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
				return dispatch.then((values) => {
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
		return Promise.resolve();
	}

	function send(message, workers) {
		if (cluster.isMaster) {
			workers = workers || mikser.workers;
			if (!workers) return Promise.resolve();
		} else {
			message.workerId = mikser.workerId;
		}

		let sendAsync = (to) => {
			return new Promise((resolve, reject) => {
				let privateMessage = extend({}, message)
				privateMessage._id = uuid.v1();
				if (mikser.options.debug) broker.pendingInfo[privateMessage._id] = privateMessage;

				broker.pending[privateMessage._id] = (privateMessage) => {
					if (mikser.options.debug) delete broker.pendingInfo[privateMessage._id];
					delete broker.pending[privateMessage._id];

					if (privateMessage.err) reject(privateMessage.err);
					else resolve(privateMessage.value);
				}
				to.send(privateMessage);
			});
		}

		if (workers) {
			if (workers.length) {
				return mikser.workersInitialized.then(() => {
					if (workers.length === 1) {
						return sendAsync(workers[0]);
					}
					return Promise.map(workers, sendAsync);
				});				
			}
		} else {
			return sendAsync(process);
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

	var pendingTimeout;
	if (cluster.isMaster) {
		mikser.on('mikser.workersInitialized', () => {
			for (let worker of mikser.workers) {
				worker.on('message', (message) => {
					// console.log('M<W', message.call, message.args[0]._id);
					return receive(message, worker).then(() => {
						let pendingCount = _.keys(mikser.broker.pending).length
						if (mikser.options.debug) {
							clearTimeout(pendingTimeout);
							pendingTimeout = setTimeout(()=> {
								debug('Pending leftover:', pendingCount);
								if (pendingCount) {
									console.log(yaml.dump(mikser.broker.pendingInfo));
								}
							}, 30*1000);
						}
					})
				});	
			}
		});
	} else {
		process.on('message', (message) => {
			// console.log('W<M', message.call, message.args[0]._id);
			return receive(message).then(() => {
				let pendingCount = _.keys(mikser.broker.pending).length
				if (mikser.options.debug) {
					clearTimeout(pendingTimeout);
					pendingTimeout = setTimeout(()=> {
						debug('Pending leftover[' + mikser.workerId + ']:', pendingCount);
						if (pendingCount) {
							console.log(yaml.dump(mikser.broker.pendingInfo));
						}
					}, 30*1000);
				}
			});
		});
	}

	mikser.on('mikser.stoppingWorkers', () => {
		if (_.keys(mikser.broker.pending).length) {
			if (mikser.options.debug) {
				console.log(yaml.dump(mikser.broker.pendingInfo));
				mikser.broker.pendingInfo = {}
			}
			mikser.broker.pending = {};
			mikser.diagnostics.log('error', 'Pending messages in broker');
		}
	});

	mikser.broker = broker;
	return Promise.resolve(mikser);
}