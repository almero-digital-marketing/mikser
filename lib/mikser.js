'use strict'

var Promise = require('bluebird');
var cluster = require('cluster');
var path = require('path');
var S = require('string');
var fs = require("fs-extra-promise");
var util = require('util');
var extend = require('node.extend');
var program = require('commander');
var _ = require('lodash');
var ChainedEmitter = require('chained-emitter').EventEmitter;

function init(options) {
	var mikser = new ChainedEmitter();
	mikser.options = options || {};
	mikser.state = {};
	mikser.cleanup = [];

	mikser.receive = function(definition) {
		if (cluster.isMaster) {
			mikser.on('workersInitialized', () => {
				for (let worker of mikser.workers) {
					worker.on('message', (message) => {
						if (definition[message.call]) {
							definition[message.call](message);
						}
					});	
				}					
			});
		} else {
			process.on('message', (message) => {
				if (definition[message.call]) {
					definition[message.call](message);
				}
			});
		}
	}

	mikser.send = function(message, workerId) {
		if(cluster.isMaster) {
			if (!mikser.workersInitialized || !mikser.workersInitialized.isFulfilled()) return;
			if (workerId == undefined) {
				for(let worker of mikser.workers) {
					worker.send(message);
				}
			} else {
				mikser.workers[workerId].send(message);
			}
		} else {
			process.send(message);
		}
	}

	mikser.loadPlugins = function() {
		return Promise.map(mikser.config.plugins, (pluginName) => {
			let plugin = mikser.runtime.findPlugin(pluginName);
			plugin = require(plugin);
			return Promise.resolve(plugin(mikser)).then(() => {
				mikser.debug('mikser')('Plugin loaded[' + mikser.workerId + ']:', pluginName);
			})
		});
	}

	if (cluster.isMaster) {
		mikser.stamp = new Date().getTime();
		mikser.cli = program.allowUnknownOption();
		mikser.cli.init = function(parse) {
			if (!parse)
				if (process.argv.indexOf('--help') != -1 ||
					process.argv.indexOf('-h') != -1) return;
			mikser.cli.parse(process.argv);
		}
		mikser.cli
			.description('Static site generator')
			.option('-m, --mikser [name]', 'set mikser folder')
			.option('-e, --env [name]', 'set custom configuration for specific environment')
			.init();
		mikser.options = _.defaults({ 
			environment: mikser.cli.env,
			workingFolder: mikser.cli.mikser || path.dirname(process.argv[1])
		}, options);
		console.log('Working folder:', mikser.options.workingFolder);

		mikser.stopWorkers = function() {
			let stop = () => {
				mikser.workersInitialized = mikser.workersInitialized || Promise.resolve();
				return mikser.workersInitialized.then(() => {
					delete mikser.workersInitialized;
					for (let worker of mikser.workers) {
						worker.kill();
					}
					delete mikser.workers;
					console.log('Workers stopped');
				});
			}
			if (mikser.cooldown) {
				clearTimeout(mikser.cooldown);
			}
			if (mikser.options.watch && mikser.config.cooldown > 0) {
				mikser.cooldown = setTimeout(stop, mikser.config.cooldown * 1000);
			} else {
				return stop();
			}
			return Promise.resolve();
		}
		
		mikser.startWorkers = function() {
			if (mikser.cooldown) {
				clearTimeout(mikser.cooldown);
				delete mikser.cooldown;
			}
			if (mikser.workersInitialized) return mikser.workersInitialized;
			mikser.workersInitialized = new Promise((resolve, reject) => {
				if (mikser.workers) throw 'Workers mismatch';
				mikser.workers = []
				var semaphor = mikser.config.workers;
				fs.writeFileAsync(mikser.config.state, JSON.stringify(mikser.state));
				for (var i = 0; i < mikser.config.workers; i++) {
					var worker = cluster.fork({
						workerId: i,
						stamp: mikser.stamp,
						config: JSON.stringify(mikser.config),
						options: JSON.stringify(mikser.options)
					});
					worker.on('message', (message) => {
						if (message.call === 'mikser.joinMaster') {
							semaphor--;
							if (semaphor == 0) {
								mikser.emit('workersInitialized');
								console.log('Workers started:', mikser.config.workers);
								resolve();
							}
						}
					});	
					mikser.workers.push(worker);
				}
			});
			return mikser.workersInitialized;
		};
		mikser.exit = function() {
			for (let worker of mikser.workers) {
				worker.kill();
			}
			return Promise.map(mikser.cleanup, (action) => action()).then(() => {
				process.exit();
			});
		};
		process.on('SIGTERM', () => {
			mikser.stopWorkers().then(() => mikser.exit());
		});
	}
	else {
		mikser.joinMaster = function() {
			mikser.send({ 
				call: 'mikser.joinMaster',
				worker: mikser.workerId
			});
			return Promise.resolve();
		};
	}

	return new Promise((resolve, reject) => {
		if (cluster.isWorker) {
			mikser.workerId = parseInt(process.env.workerId);
			mikser.stamp = parseInt(process.env.stamp);
			mikser.config = JSON.parse(process.env.config);
			mikser.options = JSON.parse(process.env.options);
			mikser.state = JSON.parse(fs.readFileSync(mikser.config.state, { encoding: 'utf8' }));
		}

		resolve(mikser);
	});
}	
module.exports = init;