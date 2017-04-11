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
var glob = require("glob");

module.exports = function(mikser) {
	mikser.config = extend({
		databaseName: 'mikser',
		databaseFolder: 'db',
		databasePid: path.join(os.tmpdir(), path.basename(mikser.options.workingFolder) + '-database.pid')
	}, mikser.config);

	if (mikser.options.help) return Promise.resolve(mikser);

	if (mikser.runtime.versionChange && mikser.runtime.versionChange.major) {
		fs.emptyDirSync(path.join(mikser.config.runtimeFolder, mikser.config.databaseFolder));
	}

	function killPreviousInstance() {
		return new Promise((resolve, reject) => { 
			try {
				let pid = fs.readFileSync(mikser.config.databasePid, {
					encoding: 'utf8'
				});
				pid = parseInt(pid);
				fs.removeSync(mikser.config.databasePid);
				process.kill(pid, 'SIGKILL');
				console.log('Killing previous instance');
				let waitCounter = 0;
				let interval = setInterval(() => {
					try {
						console.log(pid);
						process.kill(pid, 0);
						if (++waitCounter > 2) {
							clearInterval(interval);
							resolve();
						} else {
							console.log('Waiting for previous instance to quit');
						}
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

	function findMongo() {
		let WINDOWS = /win32/.test(process.platform);
		if (WINDOWS) {
			let mongos = glob.sync('**/mongod.exe', { cwd: path.join(process.env.ProgramFiles,'MongoDB') });
			if (mongos.length) {
				let mongo = path.join(process.env.ProgramFiles, 'MongoDB', mongos.pop())
				console.log('Mongo:', mongo);
				return mongo;
			}
		}
		return 'mongod';
	}

	var getDatabaseUrl = Promise.resolve();
	if (mikser.config.databaseUrl) {
		getDatabaseUrl = Promise.resolve(mikser.config.databaseUrl);
	} else if (mikser.config.databaseAddress && mikser.config.databasePort) {
		getDatabaseUrl = Promise.resolve('mongodb://' + mikser.config.databaseAddress + ':' + mikser.config.databasePort + '/' + mikser.config.databaseName);
	} else {
		mikser.config.databaseAddress = 'localhost';
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
						let mongoService = spawn(
							findMongo(), [
								'--port', mikser.config.databasePort, 
								'--dbpath', databaseFolder, 
								'--noprealloc', 
								'--smallfiles', 
								'--nojournal'
							]
						);
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

	function connect() {
		let connect = Promise.promisify(mongodb.connect);
		return connect(mikser.config.databaseUrl).then((database) => {
			database.documents = database.collection('documents');
			database.layouts = database.collection('layouts');
			database.views = database.collection('views');
			database.plugins = database.collection('plugins');
			database.documentLinks = database.collection('documentLinks');
			database.layoutLinks = database.collection('layoutLinks');
			
			database.findSome = function (collection, selector, orderBy) {
				if (selector.query && selector.projection) {
					if (orderBy) {
						return database.collection(collection).find(selector.query, selector.projection).sort(orderBy).toArray();
					} else {
						return database.collection(collection).find(selector.query, selector.projection).toArray();
					}
				}
				if (orderBy) {
					return database.collection(collection).find(selector).sort(orderBy).toArray();
				} else {
					return database.collection(collection).find(selector).toArray();
				}
			}
			database.findOne = function (collection, selector) {
				if (selector.query && selector.projection) {
					return database.collection(collection).findOne(selector.query, selector.projection);
				}
				return database.collection(collection).findOne(selector);
			}

			database.findDocuments = (selector, orderBy) => database.findSome('documents', selector, orderBy); 
			database.findDocument = (selector) => database.findOne('documents', selector);
			database.findLayouts = (selector, orderBy) => database.findSome('layouts', selector, orderBy); 
			database.findLayout = (selector) => database.findOne('layouts', selector);
			database.findViews = (selector, orderBy) => database.findSome('views', selector, orderBy); 
			database.findView = (selector) => database.findOne('views', selector);
			database.findPlugins = (selector, orderBy) => database.findSome('plugins', selector, orderBy); 
			database.findPlugin = (selector) => database.findOne('plugins', selector);

			return database;
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
		return connect();
	}).then((database) => {
		mikser.database = database;	
		if (mikser.isMaster) {
			return datatabse.collection('layouts').ensureIndex({'meta.layout': 1})
				.then(() => {
					return datatabse.collection('documents').ensureIndex({'meta.layout': 1});
				})
				.then(() => {
					return datatabse.collection('documents').ensureIndex({'source': 1});
				})
				.then(() => {
					return datatabse.collection('documentLinks').ensureIndex({'from': 1});
				})
				.then(() => {
					return datatabse.collection('documentLinks').ensureIndex({'to': 1});
				})
				.then(() => {
					return datatabse.collection('layoutLinks').ensureIndex({'from': 1});
				})
				.then(() => {
					return datatabse.collection('leyoutLinks').ensureIndex({'to': 1});
				});
		}
	}).then(() => {
		return Promise.resolve(mikser);	
	});
}