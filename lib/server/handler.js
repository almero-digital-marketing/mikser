'use strict'
var S = require('string');
var fs = require("fs-extra-promise");
var express = require('express');
var path = require('path');
var constants = require('../constants.js');

module.exports = function (mikser) {
	var debug = mikser.debug('server-handler');
	var realTimeRenders = {};

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
		});
	}

	function viewHandler(view, req, res) {
		return mikser.generator.renderView(view._id, req, res).catch((err) => {
			return mikser.diagnostics.inspect(view._id).then((diagnosed) => {
				if (!diagnosed) {
					mikser.diagnostics.log('error', err.stack || err);
				}
				res.status(500);
				return '<html><head><title>Mikser</title></head><body>' + err.message + '</body</html>';
			});
		});
	}

	return (app) => {
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
					return entityHandler.then(res.inject).catch(next);
				}
				return next();
			});
		}
	}

	mikser.on('mikser.scheduler.renderFinished', () => {
		realTimeRenders = {};
	});

}