'use strict'
var S = require('string');
var fs = require("fs-extra-promise");
var express = require('express');
var path = require('path');

module.exports = function (mikser) {
	var debug = mikser.debug('server-documents');
	return (app) => {
		app.get('*', (req, res, next) => {
			if (S(req.params[0]).endsWith('/')) {
				var url = req.params[0] + 'index.html'
			} else {
				if (!S(req.params[0]).endsWith('.html')) {
					return next();
				}
				var url = req.params[0].split('#')[0];
			}
			return mikser.database.findDocument({url: url}).then((document) => {
				if (!document) {
					debug('Static page:', url);
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
					return fs.readFileAsync(path.join(mikser.config.outputFolder, url), 'utf-8');
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
				res.send(error);
			});
		});
	}
}