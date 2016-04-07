'use strict'
var S = require('string');
var fs = require("fs-extra-promise");
var express = require('express');
var path = require('path');
var constants = require('../constants.js');

module.exports = function (mikser) {
	var debug = mikser.debug('server-documents');
	return (app) => {
		if (mikser.config.browser) {
			app.get('*', (req, res, next) => {
				if(!req.normalizedUrl) return next();
				let hostUrl = req.normalizedUrl;
				if (req.hostname) {
					hostUrl = mikser.utils.getHostUrl(hostUrl, req.hostname);
				}
				console.log(hostUrl);
				return mikser.database.findDocument({url: hostUrl}).then((document) => {
					if (!document) {
						debug('Static page:', hostUrl);
						return next();
					}
					debug('Real time preview:', document._id);
					let renderDocument = Promise.resolve();
					if (mikser.scheduler.pending || !mikser.options.watch) {
						if (mikser.queue.isPending(document._id)) {
							renderDocument = mikser.generator.renderDocument(document._id, constants.RENDER_STRATEGY_PREVIEW);							
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
						return fs.readFileAsync(path.join(mikser.config.outputFolder, hostUrl), 'utf-8');
					}).then((content) => {
						if (res.inject) {
							debug('Injecting:', document._id);
							res.inject(content);
						}
						else res.send(content);
					});
				}).catch((err) => {
					let error = err.message;
					if (err.diagnose) {
						console.log(err.diagnose.details);
						error += '\n' + err.diagnose.details;
					} 
					if (err.stack) error += '\n' + err.stack;
					res.status(500).send(error);
				});
			});
		}
	}
}