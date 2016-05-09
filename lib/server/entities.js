'use strict'
var S = require('string');
var fs = require("fs-extra-promise");
var express = require('express');
var path = require('path');
var constants = require('../constants.js');

module.exports = function (mikser) {
	var debug = mikser.debug('server-entities');
	var realTimeRenders = {};

	function documentHandler(document) {
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
						.then(mikser.scheduler.process);
				}
			}
		}				
		return renderDocument.then(() => {
			return fs.readFileAsync(path.join(mikser.config.outputFolder, document.url), 'utf-8');
		});
	}

	function viewHandler(view) {
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
							entityHandler = documentHandler(entity);
							break;
						case 'views':
							entityHandler = viewHandler(entity);
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