'use strict'

var cluster = require('cluster');
var Promise = require('bluebird');
var using = Promise.using;
var extend = require('node.extend');
var mongodb = require("mongodb");
var spawn = require('child_process').spawn;
var exec = Promise.promisify(require('child_process').exec);
var fs = require("fs-extra-promise");
var path = require('path');
var StreamSplitter = require("stream-splitter");
var os = require('os');
var net = require('net');

module.exports = function(mikser) {
	mikser.config = extend({
		databaseAddress: 'localhost',
		databaseName: 'mikser',
		databaseFolder: 'db',
		databasePid: path.join(os.tmpdir(), path.basename(mikser.options.workingFolder) + '-database.pid')
	}, mikser.config);

	if (mikser.options.help) return Promise.resolve(mikser);

	function killPreviousInstance() {
		return new Promise((resolve, reject) => { 
			try {
				let pid = fs.readFileSync(mikser.config.databasePid, {
					encoding: 'utf8'
				});
				pid = parseInt(pid);
				process.kill(pid);
				console.log('Killing previous instance');
				let interval = setInterval(() => {
					try {
						console.log(pid);
						process.kill(pid, 0);
						console.log('Waiting for previous instance to quit');
					}
					catch(e){
						clearInterval(interval);
						if (e.code != 'ESRCH' && e.code != 'ENOENT') console.log(e);
						resolve();
					}
				}, 3000);
			}
			catch(e){
				if (e.code != 'ESRCH' && e.code != 'ENOENT') console.log(e);
				resolve();
			}
		});
	}

	var getDatabaseUrl = Promise.resolve();
	if (mikser.config.databaseAddress && mikser.config.databasePort) {
		getDatabaseUrl = Promise.resolve('mongodb://' + mikser.config.databaseAddress + ':' + mikser.config.databasePort + '/' + mikser.config.databaseName);
	} else {
		if (cluster.isMaster) {
			let findPort = Promise.resolve();
			if (!mikser.config.databasePort) {
				let freeport = new Promise((resolve, reject) => {
					var server = net.createServer();
					server.listen(0, '127.0.0.1', () => {
						let port = server.address().port;
						server.close(() => {
							resolve(port);
						});
					});
				});
				findPort = freeport.then((port) => {
					mikser.config.databasePort = port
				});
			}
			getDatabaseUrl = findPort.then(() => {
				var databaseFolder = path.join(mikser.config.runtimeFolder, mikser.config.databaseFolder);
				if (mikser.runtime.isDirty()) {
					fs.emptyDirSync(databaseFolder);
				}
				fs.mkdirsSync(databaseFolder);
				return killPreviousInstance().then(() => {
					return new Promise((resolve, reject) => {
						fs.removeSync(path.join(databaseFolder, 'mongod.lock'));
						let mongoService = spawn('mongod', ['--port', mikser.config.databasePort, '--dbpath', databaseFolder, '--noprealloc', '--smallfiles', '--nojournal']);
						fs.writeFileSync(mikser.config.databasePid, mongoService.pid);
						let splitter = mongoService.stdout.pipe(StreamSplitter('\n'));
						splitter.encoding = 'utf8';
						let showMongoOutput = true;
						splitter.on('token', (token) => {
							if (showMongoOutput) {
								//console.log(token);
								if (token.indexOf('waiting for connections') != -1) {
									let databseUrl = 'mongodb://' + mikser.config.databaseAddress + ':' + mikser.config.databasePort + '/' + mikser.config.databaseName;
									console.log('Database:', databseUrl);
									showMongoOutput = false;
									setTimeout(function() {
										return resolve(databseUrl);
									}, 1000);
								}
							}
						});
					});
				});
			});
		}
	}

	var database = {
		connect: function() {
			let connect = Promise.promisify(mongodb.connect);
			return connect(mikser.config.databaseUrl).then((db) => {
				db.documents = db.collection('documents');
				db.layouts = db.collection('layouts');
				db.plugins = db.collection('plugins');
				db.documentLinks = db.collection('documentLinks');
				db.layoutLinks = db.collection('layoutLinks');
				db.findDocuments = function(selector, orderBy) {
					if (selector.query && selector.projection) {
						return db.collection('documents').find(selector.query, selector.projection).sort(orderBy).toArray();
					}
					return db.collection('documents').find(selector).sort(orderBy).toArray();
				}
				db.findDocument = function(selector) {
					if (selector.query && selector.projection) {
						return db.collection('documents').findOne(selector.query, selector.projection);
					}
					return db.collection('documents').findOne(selector);
				}
				db.findLayouts = function(selector) {
					if (selector.query && selector.projection) {
						return db.collection('layouts').findOne(selector.query, selector.projection).toArray();
					}
					return db.collection('layouts').find(selector).toArray();
				}
				db.findLayout = function(selector) {
					if (selector.query && selector.projection) {
						return db.collection('layouts').findOne(selector.query, selector.projection);
					}
					return db.collection('layouts').findOne(selector);
				}
				db.findPlugins = function(selector) {
					if (selector.query && selector.projection) {
						return db.collection('plugins').find(selector.query, selector.projection).toArray();
					}
					return db.collection('plugins').find(selector).toArray();
				}
				return db;
			}).disposer((db) => {
				db.close();
			});
		}
	};

	database.findDocuments = function(selector, orderBy) {
		return using(mikser.database.connect(), (db) => {
			return db.findDocuments(selector, orderBy);
		});
	}

	database.findDocument = function(selector) {
		return using(mikser.database.connect(), (db) => {
			return db.findDocument(selector);
		});
	}

	database.findLayouts = function(selector) {
		return using(mikser.database.connect(), (db) => {
			return db.findLayouts(selector);
		});
	}

	database.findLayout = function(selector) {
		return using(mikser.database.connect(), (db) => {
			return db.findLayout(selector);
		});
	}

	database.findPlugins = function(selector) {
		return using(mikser.database.connect(), (db) => {
			return db.findPlugins(selector);
		});
	}

	if (cluster.isMaster) {
		mikser.cleanup.push(() => {
			console.log('Database closed');
			return exec('mongo admin --port ' + mikser.config.databasePort + ' --eval "db.shutdownServer()"');
		});
	}
	return getDatabaseUrl.then((databaseUrl) => {
		mikser.config.databaseUrl = databaseUrl;
		return mongodb.connect(databaseUrl);
	}).then((db) => {
		return db.collection('layouts').ensureIndex({'meta.layout': 1})
			.then(() => {
				return db.collection('documents').ensureIndex({'meta.layout': 1});
			})
			.then(() => {
				return db.collection('documents').ensureIndex({'source': 1});
			})
			.then(() => {
				return db.collection('documentLinks').ensureIndex({'from': 1});
			})
			.then(() => {
				return db.collection('documentLinks').ensureIndex({'to': 1});
			})
			.then(() => {
				return db.collection('layoutLinks').ensureIndex({'from': 1});
			})
			.then(() => {
				return db.collection('leyoutLinks').ensureIndex({'to': 1});
			})
			.then(() => {
				db.close();
			});
	}).then(() => {
		mikser.database = database;
		return Promise.resolve(mikser);	
	});
}