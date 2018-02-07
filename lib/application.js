'use strict'
require('json.date-extensions');
JSON.useDateParser();

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
var check = require('syntax-error');
var stackTrace = require('stack-trace');

module.exports = function(options) {
	var mikser = new ChainedEmitter();
	mikser.options = options || {};
	mikser.cleanup = [];
	mikser.state = {};
	mikser.workers = [];

	mikser.require = function(module) {
	    var fileName,
	        dirName,
	        modulePath,
	        cachedModule,
	        newModule;

	    // @see http://nodejs.org/api/modules.html
	    if (module.indexOf('../') === 0 || module.indexOf('./') === 0) {
	        fileName = stackTrace.get()[1].getFileName();

	        // Where is this behavior documented?
	        // https://code.google.com/p/v8-wiki/wiki/JavaScriptStackTraceApi

	        if (fileName === '[eval]' || fileName === '[stdin]') {
	            dirName = process.cwd();
	        } else {
	            dirName = path.dirname(fileName);
	        }

	        module = dirName + '/' + module;
	    }

	    modulePath = require.resolve(module);

	    cachedModule = require.cache[modulePath];

	    delete require.cache[modulePath];

	    newModule = require(modulePath);

	    if (cachedModule) {
	        require.cache[modulePath] = cachedModule;
	    } else {
	        delete require.cache[modulePath];
	    }

	    return newModule;		
	}	

	mikser.loadPlugin = function(pluginName) {
		if (mikser.plugins[S(pluginName).camelize().s]) return Promise.resolve();
		let plugin = mikser.runtime.findPlugin(pluginName);
		try {
			plugin = require(plugin);
		}
		catch(err) {
			try {
				let pluginFile = require('resolve').sync(plugin, { basedir: __dirname });
				let pluginSource = fs.readFileSync(pluginFile);
				let diagnose = check(pluginSource, pluginFile);
				if (diagnose) {
					mikser.diagnostics.log('error', '[' + pluginName + '] Plugin failed ' + diagnose.toString());
				} else {
					mikser.diagnostics.log('error', '[' + pluginName + '] Plugin failed ' + err.stack.toString());
				}				
			} catch(err) {
				mikser.diagnostics.log('error', '[' + pluginName + '] Plugin failed ' + err);
			}
			return Promise.resolve();
		}

		return Promise.resolve(plugin(mikser)).then((loadedPlugin) => {
			mikser.plugins[S(pluginName).camelize().s] = loadedPlugin;
			if (mikser.workerId != undefined) {
				mikser.debug('mikser')('Plugin loaded[' + mikser.workerId + ']:', pluginName);
			} else {
				mikser.debug('mikser')('Plugin loaded[M]:', pluginName);
			}
		}).catch((err) => {
			if (err.stack) {
				mikser.diagnostics.log('error', '[' + pluginName + '] Plugin failed ' + err.stack.toString());
			} else {
				mikser.diagnostics.log('error', '[' + pluginName + '] Plugin failed', err.message);				
			}
		});		
	}

	mikser.loadPlugins = function() {
		mikser.plugins = {};
		let loadPlugins = Promise.resolve();
		for(let pluginName of mikser.config.plugins) {
			loadPlugins = loadPlugins.then(() => {
				return mikser.loadPlugin(pluginName)
			});
		}
		return loadPlugins.tap(() => mikser.emit('mikser.plugins'));
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
		let packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), { encoding: 'utf8' }));
		console.log('Mikser:', packageInfo.version);
		mikser.cli
			.version(packageInfo.version)
			.description('Real-time static site generator')
			.option('-m, --mikser [name]', 'set mikser folder')
			.init();
		mikser.options = _.defaults({ 
			help: process.argv.indexOf('--help') != -1,
			workingFolder: mikser.cli.mikser
		}, options, {
			workingFolder: path.dirname(process.argv[1])
		});
		mikser.options.workingFolder = path.resolve(mikser.options.workingFolder);
		console.log('Working folder:', mikser.options.workingFolder);

		mikser.stopWorkers = function() {
			if (mikser.config.cooldown === false) return Promise.resolve();
			
			let stop = () => {
				return mikser.emit('mikser.stoppingWorkers').then(() => {
					mikser.workersInitialized = mikser.workersInitialized || Promise.resolve();
					return mikser.workersInitialized.then(() => {
						delete mikser.workersInitialized;
						for (let worker of mikser.workers) {
							worker.kill();
						}
						mikser.workers = [];
						console.log('Workers stopped');
					});
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
				mikser.workers = mikser.workers || [];
				if (mikser.workers.length) throw 'Workers mismatch';
				var semaphor = mikser.config.workers;
				var configData = JSON.stringify(mikser.config);
				var runtimeConfigFile = path.join(mikser.config.runtimeFolder, 'config.json');
				fs.writeFileSync(runtimeConfigFile, configData);
				for (var i = 0; i < mikser.config.workers; i++) {
					var worker = cluster.fork({
						workerId: i,
						stamp: mikser.stamp,
						config: runtimeConfigFile,
						options: JSON.stringify(mikser.options)
					});
					worker.on('message', (message) => {
						if (message.handshake) {
							semaphor--;
							if (semaphor == 0) {
								mikser.emit('mikser.workersInitialized').then(() => {
									console.log('Workers started:', mikser.config.workers);
									resolve();
								});
							}
						}
					});
					worker.send({
						handshake: true,
						state: mikser.state
					});
					mikser.workers.push(worker);
				}
			});
			return mikser.workersInitialized;
		};
		mikser.exit = function() {
			if (mikser.workers.length) {
				for (let worker of mikser.workers) {
					worker.kill();
				}
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
		mikser.workerId = parseInt(process.env.workerId);
		mikser.stamp = parseInt(process.env.stamp);
		var configData = fs.readFileSync(process.env.config);
		mikser.config = JSON.parse(configData);
		mikser.options = JSON.parse(process.env.options);

		let handshakeReceived = false;
		let workerReady = false;
		let handshakeSent = false;

		process.on('message', (message) => {
			if (message.handshake) {
				mikser.state = message.state;
				handshakeReceived = true;
				if (!handshakeSent && workerReady) {
					handshakeSent = true;
					process.send({ 
						handshake: handshakeSent
					});				
				}
			}
		});

		mikser.joinMaster = function() {
			workerReady = true;
			if (!handshakeSent && handshakeReceived) {
				handshakeSent = true;
				process.send({ 
					handshake: handshakeSent
				});				
			}
			return Promise.resolve();
		};
	}
	return mikser;
}