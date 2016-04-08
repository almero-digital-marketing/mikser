'use strict'

var WebSocketServer = require('ws').Server;
var S = require('string');
var path = require('path');
var Promise = require('bluebird');
var net = require('net');
var minimatch = require("minimatch");
var cluster = require('cluster');

module.exports = function (mikser) {
	if (cluster.isWorker) return;

	mikser.cli
		.option('-L, --force-refresh', 'force live reload to refresh all the time')
		.init();
	mikser.options.forceRefresh = mikser.cli.forceRefresh;

	if (mikser.config.livereload === false) {
		console.log('Live reload: disabled');
		return Promise.resolve();
	}

	if (mikser.config.livereload == undefined) mikser.config.livereload = '**/*.+(css|js)';
	mikser.config.browser.push('livereload');

	let debug = mikser.debug('livereload');
	let livereload = {
		clients: {}
	}
	let lastClientId = 0;

	livereload.isLive = function(documentId) {
		if (mikser.server.isListening) {
			let documentUrl = mikser.state.urlmap[documentId];
			for(let clientId in livereload.clients) {
				if (documentUrl == livereload.clients[clientId].url) return true;
			}
		}
		return false;
	}


	livereload.refresh = function (documentId) {
		if (mikser.server.isListening) {
			for(let clientId in livereload.clients) {
				let client = livereload.clients[clientId];
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
							if (livereload.clients[clientId]) {
								debug('Live reload disconnected:', livereload.clients[clientId].url, err);
								delete livereload.clients[clientId];
							}
						}
					});
				}
			}
		}
		return Promise.resolve();
	}

	livereload.reload = function (file) {
		file = S(file).replaceAll('\\','/').ensureLeft('/').s;
		file = mikser.utils.getDomainUrl(file);
		if (mikser.server.isListening) {
			for(let clientId in livereload.clients) {
				let client = livereload.clients[clientId];
				if (!S(file).endsWith('.html')) {
					debug('Reloading[' + clientId + ']', file);
					client.socket.send(JSON.stringify({
						command: mikser.options.forceRefresh ? 'refresh' : 'reload',
						path: file,
						liveCSS: true,
						liveImg: false
					}), (err) => {
						if (err) {
							if (livereload.clients[clientId]) {
								debug('Live reload disconnected:', livereload.clients[clientId].url, err);
								delete livereload.clients[clientId];
							}
						}
					});
				}
			}
		}
		return Promise.resolve();
	}

	mikser.cleanup.push(() => {
		if (mikser.server.isListening) {
			for(let clientId in livereload.clients) {
				let client = livereload.clients[clientId];
				client.socket.destroy();
			}
		}
		return Promise.resolve();
	});

	mikser.on('mikser.server.ready', () => {	
		let liveReloadServer = new WebSocketServer({ port: mikser.config.livereloadPort });
		liveReloadServer.on('connection', (socket) => {
			let clientId = lastClientId++;
			livereload.clients[clientId] = {
				socket: socket
			};

			socket.on('close', (socket) => {
				if (livereload.clients[clientId]) {
					debug('Live reload disconnected:', livereload.clients[clientId].url);
					delete livereload.clients[clientId];								
				}
			});

			socket.on('message', (message) => {
				message = JSON.parse(message);
				if (message.command === 'hello') {
					socket.send(JSON.stringify({
						command: 'hello',
						protocols: ['http://livereload.com/protocols/official-7'],
						serverName: path.basename(mikser.options.workingFolder)
					}));
				}
				else if (message.command === 'info') {
					livereload.clients[clientId].url = mikser.utils.getNormalizedUrl(message.url);
					debug('Live reload connected:', livereload.clients[clientId].url);
				}
			});
		});
	});

	mikser.on('mikser.watcher.outputAction', (event, file) => {
		if (minimatch(file, mikser.config.livereload)) {
			return livereload.reload(file);
		}
	});

	mikser.on('mikser.scheduler.renderedDocument', (documentId) => {
		return livereload.refresh(documentId);
	});

	if (!mikser.config.livereloadPort) {
		let freeport = new Promise((resolve, reject) => {
			var server = net.createServer();
			server.listen(0, '127.0.0.1', () => {
				let port = server.address().port;
				server.close(() => {
					resolve(port);
				});
			});
		});
		return freeport.then((port) => {
			mikser.config.livereloadPort = port
		});
	}

	return Promise.resolve(livereload);
};