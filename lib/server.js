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

function init(mikser) {
	var debug = mikser.debug('server');
	var server = {};
	mikser.config = extend({
		serverPort: 0,
		livereload: true
	}, mikser.config);

	return new Promise((resolve, reject) => {
		mikser.server = server;

		if(cluster.isMaster) {
			mikser.server.clients = {};
			mikser.server.clientId = 0;
			mikser.server.connections = {};
			mikser.server.connectionId = 0;
			mikser.server.history = [];
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

			server.reload = function (file) {
				file = S(file).replaceAll('\\','/').ensureLeft('/').s;
				if (listening) {
					for(let clientId in mikser.server.clients) {
						let client = mikser.server.clients[clientId];
						if (!S(file).endsWith('.html') || client.url && S(client.url).endsWith(file)) {
							// console.log('Reloading[' + clientId + ']', file);
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
						return mikser.database.findDocuments({url: url}).then((documents) => {
							if (documents[0]) {
								let documentId = documents[0]._id;
								if (mikser.renderqueue.queue[documentId]) {
									return new Promise((resolve, reject) => {
										mikser.renderqueue.enqueueDocument(documentId, constants.RENDER_STRATEGY_URGENT, (err) => {
											if (err) reject(err);
											resolve();
										}).then((enqueued) => {
											if (!enqueued) resolve();
										});
									});
								}
							}
						}).then(() => {
							fs.readFileAsync(path.join(mikser.config.outputFolder, url), 'utf-8').then((data) => {
								let $ = cheerio.load(data);
								var snippet = "<script>document.write('<script src=\"http://' + (location.host || 'localhost').split(':')[0] + ':" +
								mikser.config.serverPort + "/livereload.js?snipver=1&port=" + mikser.config.serverPort + "\"></' + 'script>')</script>";
								$('body').append(snippet);
								res.send($.html());
							});
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
								server.history = _.without(server.history, url);
								server.history.push(url);
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
						if (mikser.config.shared.length) {
							for (let share of mikser.config.shared) {
								console.log('Web: http://localhost:' + mikser.config.serverPort + S(share).ensureLeft('/').s);
							}
						}
						else {
							console.log('Web: http://localhost:' + mikser.config.serverPort);							
						}
						resolve();
					});		
				});				
			};
		}
		resolve(mikser);
	});
}	
module.exports = init;