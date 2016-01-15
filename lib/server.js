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

module.exports = function(mikser) {
	var debug = mikser.debug('server');
	var server = {};
	mikser.config = extend({
		serverPort: 0,
		livereload: true
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

		mikser.server.clients = {};
		mikser.server.clientId = 0;
		mikser.server.connections = {};
		mikser.server.connectionId = 0;
		let listening = false;

		mikser.cleanup.push(() => {
			if (listening) {
				for(let clientId in mikser.server.clients) {
					let client = mikser.server.clients[clientId];
					client.socket.destroy();
				}
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

		server.refresh = function (documentId) {
			if (listening) {
				for(let clientId in mikser.server.clients) {
					let client = mikser.server.clients[clientId];
					let documentUrl = client.url;
					if (documentId) documentUrl = mikser.state.urlmap[documentId];
					debug('Client:', client.url, documentUrl);
					if (client.url == documentUrl) {
						debug('Refreshing[' + clientId + ']', documentUrl);
						client.socket.send(JSON.stringify({
							command: 'reload',
							path: documentUrl
						}), (err) => {
							if (err) {
								debug('Live reload disconnected:', mikser.server.clients[clientId].url, err);
								delete mikser.server.clients[clientId];
							}
						});
					}
				}
			}
			return Promise.resolve();
		}

		server.reload = function (file) {
			file = S(file).replaceAll('\\','/').ensureLeft('/').s;
			if (listening) {
				for(let clientId in mikser.server.clients) {
					let client = mikser.server.clients[clientId];
					if (!S(file).endsWith('.html')) {
						debug('Reloading[' + clientId + ']', file);
						client.socket.send(JSON.stringify({
							command: 'reload',
							path: file,
							liveCSS: true,
							liveImg: true
						}), (err) => {
							if (err) {
								debug('Live reload disconnected:', mikser.server.clients[clientId].url, err);
								delete mikser.server.clients[clientId];
							}
						});
					}
				}
			}
			return Promise.resolve();
		};

		server.listen = function() {
			if (listening || !mikser.options.server) return Promise.resolve();
			listening = true;

			let app = express();
			let livereload = function (req, res, next) {
				if (S(req.params[0]).endsWith('/')) {
					var url = req.params[0] + 'index.html'
				} else {
					if (!S(req.params[0]).endsWith('.html')) {
						return next();
					}
					var url = req.params[0].split('#')[0];
				}
				let renderDocument = Promise.resolve();
				if (mikser.scheduler.pending || !mikser.options.watch) {
					renderDocument = mikser.database.findDocument({url: url}).then((document) => {
						console.log('Real time preview:', document._id);
						return mikser.generator.renderDocument(document._id, constants.RENDER_STRATEGY_PREVIEW);
					});
				} else {
					renderDocument = fs.readFileAsync(path.join(mikser.config.outputFolder, url), 'utf-8');
				}
				return renderDocument.then((content) => {
					if (mikser.options.watch) {
						var snippet = "<script>document.write('<script src=\"http://' + (location.host || 'localhost').split(':')[0] + ':" +
						mikser.config.serverPort + "/livereload.js?snipver=1&port=" + mikser.config.serverPort + "\"></' + 'script>')</script>";
						content = content.replace('</body>', snippet + '</body>');
						res.send(content);							
					} else {
						mikser.tools.compile().then(mikser.manager.copy).then(() => { 
							res.send(content);
						}).then(mikser.manager.glob).then(mikser.scheduler.process);							
					}						
				}).catch((err) => {
					let error = err.message;
					if (err.diagnose) {
						console.log(err.diagnose.details);
						err += '\n' + err.diagnose.details;
					} 
					if (err.stack) err += '\n' + err.stack;
					res.send(error);
				});			
			}
			if (mikser.config.livereload) {
				app.use('*', livereload);
			}
			app.use(express.static(path.join(__dirname,'../public')));
			app.use(express.static(mikser.config.outputFolder));
			return mikser.emit('mikser.server.listen', app).then(() => {
				mikser.server.httpServer = http.createServer(app);
				if (mikser.config.livereload) {
					mikser.server.httpServer.on('connection', (socket) => {
						let connectionId = mikser.server.connectionId++;
						mikser.server.connections[connectionId] = {
							socket: socket
						};

						socket.on('close', (socket) => {
							delete mikser.server.connections[connectionId];
						});
					});
					let liveReloadServer = new WebSocketServer({ server: mikser.server.httpServer });
					liveReloadServer.on('connection', (socket) => {
						let clientId = mikser.server.clientId++;
						mikser.server.clients[clientId] = {
							socket: socket
						};

						socket.on('close', (socket) => {
							if (mikser.server.clients[clientId]) {
								debug('Live reload disconnected:', mikser.server.clients[clientId].url);
								delete mikser.server.clients[clientId];								
							}
						});

						socket.on('message', (message) => {
							// console.log(message);
							message = JSON.parse(message);
							if (message.command === 'hello') {
								socket.send(JSON.stringify({
									command: 'hello',
									protocols: ['http://livereload.com/protocols/official-7'],
									serverName: path.basename(mikser.options.workingFolder)
								}));
							}
							else if (message.command === 'info') {
								let url = message.url.split('#')[0].split('?')[0];
								if (S(url).endsWith('/')) {
									url = url + 'index.html';
								}
								url = '/' + decodeURI(url).split('/').slice(3).join('/');
								mikser.server.clients[clientId].url = url;
								debug('Live reload connected:', url);
							}
						});
					});
				} else {
					console.log('Live reload: disabled');
				}
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