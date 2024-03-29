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
var constants = require('./constants');
var compression = require('compression');
var vhost = require( 'vhost' );
var os = require('os');

module.exports = function(mikser) {
	var debug = mikser.debug('server');
	var server = {
		isListening: false,
		hot: []
	};
	mikser.config = extend({
		serverPort: 0,
		serverCaching: false,
		serverDomains: false
	}, mikser.config);

	mikser.server = server;

	server.isHot = function(collection, entityId) {
		if (cluster.isMaster) {
			if (mikser.server.isListening) {
				let entity = mikser.runtime.findEntity(collection, entityId);
				if (entity) {
					return Promise.resolve(mikser.server.hot.indexOf(entity.url) > -1);
				}
			}
			return Promise.resolve(false);
		} else {
			return broker.call('mikser.server.isHot', collection, entityId);
		}
	}

	if(cluster.isMaster) {
		mikser.cli
			.option('-S, --no-server', 'don\'t run web server to access your generated website')
			.init();
		if (mikser.options.server !== false) {
			mikser.options = _.defaults({ 
				server: mikser.cli.server
			}, mikser.options);
		}

		mikser.cleanup.push(() => {
			if (mikser.server.isListening) {
				let closeAsync = Promise.promisify(mikser.server.httpServer.close, mikser.server.httpServer);
				return closeAsync();
			}
			return Promise.resolve();
		});

		server.listen = function() {
			if (mikser.server.isListening || !mikser.options.server) return Promise.resolve();
			mikser.server.isListening = true;

			let app = mikser.options.app || express();
			app.use(compression());
			app.use(function (err, req, res, next) {
				let error = err.message;
				if (err.diagnose) {
					console.log(err.diagnose.details);
					error += '\n' + err.diagnose.details;
				} 
				if (err.stack) error += '\n' + err.stack;
				res.status(500).send(err);
			});
			app.get('*', (req, res, next) => {
				if (S(req.params[0]).endsWith('/')) {
					var url = req.params[0] + mikser.config.cleanUrlDestination
				} else {
					var url = req.params[0].split('#')[0];
					if ((path.extname(url) || path.basename(url)[0] == '.') 
						&& !S(url).endsWith('.html')) {
						return next();
					}
				}
				if (mikser.config.cleanUrls && !path.extname(url) && path.basename(url)[0] != '.') {
					url += '/' + mikser.config.cleanUrlDestination;
				}
				if (!req.normalizedUrl || S(req.normalizedUrl).endsWith('.html')) {
					req.normalizedUrl = url;
				}
				next();
			});

			let serverOptions = {};
			if (mikser.config.serverCaching) {
				serverOptions.maxAge = mikser.config.serverCaching;
			}
			let serverFolder = mikser.config.outputFolder
			if (mikser.config.build) {
				serverFolder = mikser.config.buildFolder;
			}
			mikser.server.ws = require('express-ws')(app);

			return mikser.emit('mikser.server.listen', app).then(() => {
				if (!mikser.config.serverDomains) {
					console.log('Serving from:', serverFolder);
					app.use(express.static(serverFolder, serverOptions));
				} else {
					let localhost = vhost('localhost', express.static(serverFolder));
					app.use(localhost);
					if (mikser.config.serverDomains === true) {
						for (let share of mikser.config.shared) {
							let domainFolder = path.join(serverFolder, share);
							let host = vhost(share, express.static(domainFolder));
							console.log('Serving:', share, 'from:', domainFolder);
							app.use(host);
						}
					} else {
						for (let domain in mikser.config.serverDomains) {
							let share = mikser.config.serverDomains[domain];
							let domainFolder = path.join(serverFolder, share);
							let host = vhost(domain, express.static(domainFolder));
							console.log('Serving:', domain, 'from:', domainFolder);
							app.use(host);
						}
					}
				}
				mikser.server.app = app;
				return mikser.emit('mikser.server.ready');
			}).then(() => {
				return new Promise((resolve, reject) => {
					app.use((err, req, res, next) => {
						if (err) {
							mikser.diagnostics.log('error', err.stack || err);
						}
					});
					mikser.server.app.listen(mikser.config.serverPort, (err) => {
						let showServerInfo = () => {
							if (mikser.config.shared.length) {
								for (let share of mikser.config.shared) {
									console.log('Web: http://' + os.hostname() + ':' + mikser.config.serverPort + S(share).ensureLeft('/').ensureRight('/').s);
								}
							}
							else {
								console.log('Web: http://' + os.hostname() + ':' + mikser.config.serverPort);							
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

		return mikser.utils.resolvePort(mikser.config.serverPort, 'server').then((port) => {
			let serverPort = mikser.config.serverPort;
			if (serverPort && serverPort !== port) {
				mikser.diagnostics.log('warning', `Found server config port: ${serverPort}, but resolved with ${port}`);
			}
			mikser.config.serverPort = port;
			debug('Port:', port);
			return mikser;
		});
	}

	return Promise.resolve(mikser);
}