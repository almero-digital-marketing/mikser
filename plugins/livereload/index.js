'use strict'

var S = require('string');
var path = require('path');
var Promise = require('bluebird');
var net = require('net');
var minimatch = require("minimatch");
var cluster = require('cluster');
var _ = require('lodash');

module.exports = function (mikser) {
	if (cluster.isWorker) return;
	if (!mikser.config.browser) return Promise.resolve();

	mikser.cli
		.option('-L, --force-refresh', 'force live reload to refresh all the time')
		.init();
	mikser.options.forceRefresh = mikser.cli.forceRefresh;

	if (mikser.config.watcher) {
		mikser.config.watcher.output = mikser.config.watcher.output || ['**/*.jpeg', '**/*.jpg', '**/*.gif', '**/*.png', '**/*.svg'];
		mikser.config.watcher.reload = mikser.config.watcher.reload || ['**/*.css', '**/*.js'];		
	}

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
					if (client.entity && (client.entity._id == entity._id)) {
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
						let message = {
							command: 'reload',
							path: file,
							liveCSS: !mikser.options.forceRefresh,
							liveImg: false
						}
						client.socket.send(JSON.stringify(message), (err) => {
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

	mikser.on('mikser.server.listen', (app) => {
		app.ws('/livereload', function(socket, req) {
			let clientId = lastClientId++;
			debug('Clients:', _.keys(livereload.clients).length);

			socket.on('close', (socket) => {
				if (livereload.clients[clientId]) {
					debug('Live reload disconnected:', livereload.clients[clientId].url);
					mikser.server.hot = _.remove(mikser.server.hot, livereload.clients[clientId].url);
					delete livereload.clients[clientId];								
				}
			});
			socket.on('message', function(message) {
				message = JSON.parse(message);
				if (message.command === 'hello') {
					socket.send(JSON.stringify({
						command: 'hello',
						protocols: ['http://livereload.com/protocols/official-7'],
						serverName: path.basename(mikser.options.workingFolder)
					}));
					livereload.clients[clientId] = {
						socket: socket
					};
				}
				else if (message.command === 'info') {
					livereload.clients[clientId].url = mikser.utils.getNormalizedUrl(message.url);
					debug('Live reload connected:', livereload.clients[clientId].url);
				}
				else if (message.command === 'details') {
					let entity = mikser.runtime.findEntity(message.entityCollection, message.entityId);
					if (entity) {
						livereload.clients[clientId].entity = entity;
						mikser.server.hot.push(entity.url);
						debug('Live entity connected:', livereload.clients[clientId].entity._id);						
					}
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

	return Promise.resolve(livereload);
};