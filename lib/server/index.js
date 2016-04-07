'use strict'

var http = require('http');
var express = require('express');
var Promise = require('bluebird');
var path = require('path');
var cluster = require('cluster');
var extend = require('node.extend');
var S = require('string');
var fs = require("fs-extra-promise");
var _ = require('lodash');
var constants = require('../constants.js');

module.exports = function(mikser) {
	var debug = mikser.debug('server');
	var server = {
		isListening: false,
		modules: ['browser', 'documents']
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
				return closeAsync();
			}
			return Promise.resolve();
		});

		server.listen = function() {
			if (mikser.server.isListening || !mikser.options.server) return Promise.resolve();
			mikser.server.isListening = true;

			let app = mikser.options.app || express();

			app.get('*', (req, res, next) => {
				if (S(req.params[0]).endsWith('/')) {
					var url = req.params[0] + 'index.html'
				} else {
					if (!S(req.params[0]).endsWith('.html')) {
						return next();
					}
					var url = req.params[0].split('#')[0];
				}
				if (!req.normalizedUrl || S(req.normalizedUrl).endsWith('.html')) {
					req.normalizedUrl = url;					
				}
				next();
			});

			mikser.server.modules.forEach((module) => {
				module(app);
			});

			app.use(express.static(mikser.config.outputFolder));

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

		return Promise.map(mikser.server.modules, (module) => {
			return require('./' + module)(mikser);
		}).then((modules) => {
			mikser.server.modules = modules;
			return mikser;
		});
	}

	return Promise.resolve(mikser);
}