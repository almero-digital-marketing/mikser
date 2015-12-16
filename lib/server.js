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
var cheerio = require('cheerio');
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
					let documentUrl = mikser.state.urlmap[documentId];
					if (client.url == documentUrl) {
						debug('Refreshing[' + clientId + ']', documentUrl);
						client.socket.send(JSON.stringify({
							command: 'reload',
							path: documentUrl
						}), (err) => {
							if (err) console.log('Live reload error', err);
						});
					}
				}
			}
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
							if (err) console.log('Live reload error', err);
						});
					}
				}
			}
			return Promise.resolve();
		};

		server.listen = function() {
			if (listening) return Promise.resolve();
			listening = true;

			let app = express();
			if (mikser.config.livereload) {
				let injectScripts = function (req, res, next) {
					if (S(req.params[0]).endsWith('/')) {
						var url = req.params[0] + 'index.html'
					} else {
						if (!S(req.params[0]).endsWith('.html')) {
							return next();
						}
						var url = req.params[0].split('#')[0];
					}
					let renderDocument = Promise.resolve();
					if (mikser.scheduler.pending) {
						renderDocument = mikser.database.findDocument({url: url}).then((document) => {
							console.log('Real time preview:', document._id);
							return mikser.generator.renderDocument(document._id, constants.RENDER_STRATEGY_PREVIEW);
						});
					} else {
						renderDocument = fs.readFileAsync(path.join(mikser.config.outputFolder, url), 'utf-8');
					}
					return renderDocument.then((content) => {
						let $ = cheerio.load(content);
						var snippet = "<script>document.write('<script src=\"http://' + (location.host || 'localhost').split(':')[0] + ':" +
						mikser.config.serverPort + "/livereload.js?snipver=1&port=" + mikser.config.serverPort + "\"></' + 'script>')</script>";
						$('body').append(snippet);
						res.send($.html());
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
				app.use('*', injectScripts);
				app.use(express.static(mikser.config.outputFolder));
				app.use(express.static(path.join(__dirname,'../public')));
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
				let liveReloadServer = new WebSocketServer({ server: mikser.server.httpServer });
				liveReloadServer.on('connection', (socket) => {
					let clientId = mikser.server.clientId++;
					mikser.server.clients[clientId] = {
						socket: socket
					};

					socket.on('close', (socket) => {
						debug('Live reload disconnected:', mikser.server.clients[clientId].url);
						delete mikser.server.clients[clientId];
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
							if (S(message.url).endsWith('/')) {
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
				app.use(express.static(mikser.config.outputFolder));
				mikser.server.httpServer = http.createServer(app);
			}

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
		};
	}
	return Promise.resolve(mikser);
}