'use strict'

var WebSocketServer = require('ws').Server;
var S = require('string');
var path = require('path');
var Promise = require('bluebird');
var net = require('net');
var minimatch = require("minimatch");
var cluster = require('cluster');
var _ = require('lodash');

module.exports = function (mikser) {
	if (cluster.isWorker) return;

	mikser.cli
		.option('-L, --force-refresh', 'force live reload to refresh all the time')
		.init();
	mikser.options.forceRefresh = mikser.cli.forceRefresh;

	mikser.config.watcher.output = ['**/*.jpeg', '**/*.jpg', '**/*.gif', '**/*.png', '**/*.svg'];
	mikser.config.watcher.reload = ['**/*.css', '**/*.js'];


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

	let refreshQueue = {};
	let refreshTimeout;

	livereload.refresh = function (collection, entityId) {
		if (mikser.server.isListening) {
			for(let clientId in livereload.clients) {
				let client = livereload.clients[clientId];
				if (!client.url) continue;
				let entity = mikser.runtime.findEntity(collection, entityId);
				if (entity && entity.url) {
					debug('Client:', client.url, entity.url);
					if (client.url == entity.url) {
						if (refreshTimeout) clearTimeout(refreshTimeout);
						refreshQueue[clientId] = () => {
							debug('Refreshing[' + clientId + ']', entity.url);
							client.socket.send(JSON.stringify({
								command: 'reload',
								path: entity.url
							}), (err) => {
								if (err) {
									if (livereload.clients[clientId]) {
										debug('Live reload disconnected:', livereload.clients[clientId].url, err);
										mikser.server.hot = _.remove(mikser.server.hot, livereload.clients[clientId].url);
										delete livereload.clients[clientId];
									}
								}
							});
						};
						refreshTimeout = setTimeout(() => {
							for(let key in refreshQueue) {
								refreshQueue[key]();
								delete refreshQueue[key];
							}
						}, 500);
					}
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
					let action = () => {
						client.socket.send(JSON.stringify({
							command: mikser.options.forceRefresh ? 'reload' : 'refresh',
							path: file,
							liveCSS: !mikser.options.forceRefresh,
							liveImg: false
						}), (err) => {
							if (err) {
								if (livereload.clients[clientId]) {
									debug('Live reload disconnected:', livereload.clients[clientId].url, err);
									mikser.server.hot = _.remove(mikser.server.hot, livereload.clients[clientId].url);
									delete livereload.clients[clientId];
								}
							}
						});
					}
					if (mikser.options.forceRefresh) {
						if (refreshTimeout) clearTimeout(refreshTimeout);
						refreshQueue[clientId] = action;
						refreshTimeout = setTimeout(() => {
							for(let key in refreshQueue) {
								refreshQueue[key]();
								delete refreshQueue[key];
							}
						}, 500);						
					} else {
						action();
					}
				}
			}
		}
		return Promise.resolve();
	}

	mikser.cleanup.push(() => {
		if (livereload.server) {
			let closeAsync = Promise.promisify(livereload.server.close, {context: livereload.server });
			return closeAsync().catch((err) => {
				for(let clientId in livereload.clients) {
					let client = livereload.clients[clientId];
					client.socket.destroy();
				}
			});
		}
		return Promise.resolve();
	});

	mikser.on('mikser.server.ready', () => {	
		livereload.server = new WebSocketServer({ port: mikser.config.livereloadPort });
		livereload.server.on('connection', (socket) => {
			let clientId = lastClientId++;
			livereload.clients[clientId] = {
				socket: socket
			};
			debug('Clients:', _.keys(livereload.clients).length);

			socket.on('close', (socket) => {
				if (livereload.clients[clientId]) {
					debug('Live reload disconnected:', livereload.clients[clientId].url);
					mikser.server.hot = _.remove(mikser.server.hot, livereload.clients[clientId].url);
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
					mikser.server.hot.push(livereload.clients[clientId].url);
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
		return livereload.refresh('documents', documentId);
	});


	mikser.on('mikser.scheduler.viewInvalidated', (viewId) => {
		return livereload.refresh('views', viewId);
	});

	mikser.on('mikser.runtime.link', (entity) => {
		if (entity.collection == 'views') {
			return livereload.refresh(entity.collection, entity._id);		
		}
	});

	return mikser.utils.resolvePort(mikser.config.livereloadPort, 'livereload').then((port) => {
		let livereloadPort = mikser.config.livereloadPort;
		if (livereloadPort && livereloadPort !== port) {
			mikser.diagnostics.log('warning', `Livereload config port: ${livereloadPort} is already in use, resolved with ${port}`);
		}
		mikser.config.livereloadPort = port;
		debug('Port:', port);
		return Promise.resolve(livereload);
	});
};