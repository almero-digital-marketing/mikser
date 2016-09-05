'use strict'
var S = require('string');
var fs = require("fs-extra-promise");
var express = require('express');
var path = require('path');
var constants = require('../lib/constants.js');
var Promise = require('bluebird');
var _ = require('lodash');

module.exports = function (mikser) {
	var debug = mikser.debug('engine');
	var realTimeRenders = {};
	mikser.engine = {
		inject: function(content){
			return content;
		}
	}

	mikser.on('mikser.server.listen', (app) => {
		function documentHandler(document, req, res) {
			let renderDocument = Promise.resolve();
			if (mikser.scheduler.pending || !mikser.options.watch) {
				if (mikser.queue.isPending(document._id)) {
					if (!realTimeRenders[document._id]) {
						debug('Real time preview:', document._id);
						realTimeRenders[document._id] = true;
						renderDocument = mikser.generator.renderDocument(document._id, constants.RENDER_STRATEGY_PREVIEW);
					}
				} else {
					if (!mikser.options.watch) {
						renderDocument = mikser.manager.glob()
							.then(mikser.tools.compile)
							.then(mikser.manager.sync)
							.then(mikser.queue.drain).then(() => { 
								mikser.scheduler.pending = false;
								return mikser.generator.renderDocument(document._id, constants.RENDER_STRATEGY_STANDALONE);
							})
							.then((content) => {
								return mikser.scheduler.process().then(() => content);
							});
					}
				}
			}				
			return renderDocument.then((content) => {
				if (!content) return fs.readFileAsync(path.join(mikser.config.outputFolder, document.url), 'utf-8');
				return content;
			}).catch((err) => {
				res.status(500);
				return '<html><head><title>Mikser</title></head><body>' + err.message + '</body></html>';
			});
		}

		function viewHandler(view, req, res) {
			let options = _.pick(req, view.meta.pick);
			return Promise.fromCallback((callback) => {
				app.render(view.source, options, callback);
			}).catch((err) => {
				res.status(500);
				return '<html><head><title>Mikser</title></head><body>' + err.message + '</body></html>';
			});
		}

		if (mikser.config.browser) {
			app.get('*', (req, res, next) => {
				if(!req.normalizedUrl) return next();
				let hostUrl = req.normalizedUrl;
				if (mikser.config.serverDomains) {
					hostUrl = mikser.utils.getHostUrl(hostUrl, req.hostname);
				}
				let entity = mikser.runtime.findUrl(hostUrl);
				if (entity) {
					debug(hostUrl);
					let entityHandler = Promise.resolve();
					switch(entity.collection) {
						case 'documents':
							entityHandler = documentHandler(entity, req, res);
							break;
						case 'views':
							entityHandler = viewHandler(entity, req, res);
							break;
					}
					return entityHandler.then((content) => {
						content = mikser.engine.inject(content);
						res.send(content);
					}).catch(next);
				}
				return next();
			});
		}

		let viewEngine = (filePath, options, next) => {
			let viewId = filePath.replace(mikser.config.viewsFolder, '');
			viewId = S(viewId).replaceAll('\\','/').s;

			return mikser.startWorkers().then(() => {
				let cursor = ++mikser.scheduler.cursor % mikser.config.workers;
				let action = mikser.broker.call(
					'mikser.generator.renderView', 
					mikser.workers[cursor], 
					viewId, 
					options)
				.then((content) => {
					next(null, content);
				}).catch((err) => {
					mikser.diagnostics.log('error', err);
					next(err);
				});
				mikser.queue.push(action);
				return action;
			}).then(() => {
				if (!mikser.scheduler.processing) {
					mikser.queue.clean();
					return mikser.stopWorkers();
				}
			});
		}
		app.set('views', mikser.config.viewsFolder);
		return Promise.map(mikser.parser.engines, (engine) => {
			if (engine.extensions) {
				return Promise.map(engine.extensions, (ext) => {
					app.engine(ext, viewEngine);			
				});
			}
		});
	});	

	mikser.on('mikser.scheduler.renderFinished', () => {
		realTimeRenders = {};
	});
	return Promise.resolve(mikser);
}