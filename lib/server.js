'use strict'

var http = require('http');
var express = require('express');
var Promise = require('bluebird');
var path = require('path');
var cluster = require('cluster');
var extend = require('node.extend');
var WebSocketServer = require('ws').Server;
var S = require('string');
var fs = require("fs-extra-promise");
var _ = require('lodash');
var constants = require('./constants.js');
var controllers = require('../api/controllers');
var browserify = require('browserify-middleware');

module.exports = function(mikser) {
	var debug = mikser.debug('server');
	var server = {
		isListening: false
	};
	mikser.config = extend({
		serverPort: 0,
	}, mikser.config);

	mikser.server = server;

	if(cluster.isMaster) {
		mikser.cli
			.option('-S, --no-server', 'don\'t run web server to access your generated website')
			.init();
		if (mikser.options.server !== false) {
			mikser.options = _.defaults({ 
				server: mikser.cli.server
			}, mikser.options);
		}
		mikser.server.connections = {};
		mikser.server.connectionId = 0;

		mikser.cleanup.push(() => {
			if (mikser.server.isListening) {
				for(let connectionId in mikser.server.connections) {
					let connection = mikser.server.connections[connectionId];
					connection.socket.destroy();
				}
				let closeAsync = Promise.promisify(mikser.server.httpServer.close, mikser.server.httpServer);
				return closeAsync().then(() => {
					console.log('Live reload closed');
				});
			}
			return Promise.resolve();
		});

		server.listen = function() {
			if (mikser.server.isListening || !mikser.options.server) return Promise.resolve();
			mikser.server.isListening = true;

			let app = express();
			app.get('*', (req, res, next) => {
				if (S(req.params[0]).endsWith('/')) {
					var url = req.params[0] + 'index.html'
				} else {
					if (!S(req.params[0]).endsWith('.html')) {
						return next();
					}
					var url = req.params[0].split('#')[0];
				}
				return mikser.database.findDocument({url: url}).then((document) => {
					if (!document) {
						debug('Static page:', url);
						return next();
					}
					debug('Real time preview:', document._id);
					let renderDocument = Promise.resolve();
					if (mikser.scheduler.pending || !mikser.options.watch) {
						if (mikser.queue.isPending(document._id)) {
							renderDocument = mikser.generator.renderDocument(document._id, constants.RENDER_STRATEGY_PREVIEW);							
						} else {
							if (!mikser.options.watch) {
								renderDocument = mikser.manager.glob()
									.then(mikser.tools.compile)
									.then(mikser.manager.sync)
									.then(mikser.queue.drain).then(() => { 
										mikser.scheduler.pending = false;
										return mikser.generator.renderDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
									})
									.then(mikser.scheduler.process);
							}
						}
					}				
					return renderDocument.then(() => {
						return fs.readFileAsync(path.join(mikser.config.outputFolder, url), 'utf-8');
					}).then((content) => {
						debug('Injecting:', document._id);
						content = content.replace('</body>','<script src="/mikser/bundle.js" async defer></script></body>');
						res.send(content);							
					});
				}).catch((err) => {
					let error = err.message;
					if (err.diagnose) {
						console.log(err.diagnose.details);
						error += '\n' + err.diagnose.details;
					} 
					if (err.stack) error += '\n' + err.stack;
					res.send(error);
				});
			});

			app.use(controllers(mikser));
			app.use(express.static(mikser.config.outputFolder));

			let modules = mikser.config.browser.map((pluginName) => {
				let pluginModule = {};
				let plugin = mikser.runtime.findBrowserPlugin(pluginName);
				pluginModule[plugin] = {expose: pluginName};
				debug('Browser module[' + pluginName + ']:', plugin);
				return pluginModule;
			});
			app.use('/mikser/browser', express.static(path.join(mikser.options.workingFolder, 'browser')));
			app.use('/mikser/browser', express.static(path.join(__dirname, '..', 'browser')));
			app.use('/mikser/node_modules', express.static(path.join(mikser.options.workingFolder, 'node_modules')));
			app.use('/mikser/node_modules', express.static(path.join(__dirname, '..', 'node_modules')));
			let mainModule = {};
			mainModule[path.join(__dirname, '../public/mikser.js')] = {run: true};
			modules.push(mainModule);
			app.use('/mikser/bundle.js', browserify(modules));

			return mikser.emit('mikser.server.listen', app).then(() => {
				mikser.server.httpServer = http.createServer(app);
				mikser.server.httpServer.on('connection', (socket) => {
					let connectionId = mikser.server.connectionId++;
					mikser.server.connections[connectionId] = {
						socket: socket
					};

					socket.on('close', (socket) => {
						delete mikser.server.connections[connectionId];
					});
				});
			}).then(() => {
				return mikser.emit('mikser.server.ready');
			}).then(() => {
				return new Promise((resolve, reject) => {
					mikser.server.httpServer.listen(mikser.config.serverPort, (err) => {
						mikser.config.serverPort = mikser.server.httpServer.address().port;
						let showServerInfo = () => {
							if (mikser.config.shared.length) {
								for (let share of mikser.config.shared) {
									console.log('Web: http://localhost:' + mikser.config.serverPort + S(share).ensureLeft('/').s);
								}
							}
							else {
								console.log('Web: http://localhost:' + mikser.config.serverPort);							
							}
						}
						showServerInfo();
						mikser.on('mikser.scheduler.renderFinished', () => {
							if (!_.keys(mikser.server.clients).length) showServerInfo();						
						});
						resolve();
					});		
				});				
			});
		};
	}
	return Promise.resolve(mikser);
}