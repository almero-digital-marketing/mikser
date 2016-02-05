'use strict'

var Promise = require('bluebird');
var path = require('path');
var cluster = require('cluster');
var extend = require('node.extend');
var S = require('string');
var fs = require("fs-extra-promise");
var shortcode = require('shortcode-parser');
var minimatch = require("minimatch");
var _ = require('lodash');
var using = Promise.using;
var constants = require('./constants.js');
var yaml = require('js-yaml');

Promise.config({cancellation: true});

module.exports = function(mikser) {
	var generator = {
		engines: []
	};
	var debug = mikser.debug('generator');

	generator.findEngine = function(context) {
		let source;
		if (context.document) {
			source = context.document.source;
		}
		if (context.layout) {
			source = context.layout.source;
		}
		if (!source) return;

		for (let engine of mikser.generator.engines) {
			if (minimatch(source, engine.pattern)) {
				return engine;
			}
		}
	}

	generator.render = function(context) {
		try {
			let engine = generator.findEngine(context);
			if (engine) {
				let functions = _.functions(context);
				for (let functionName of functions) {
					if (!context['_' + functionName]) {
						context['_' + functionName] = context[functionName];
						context[functionName] = function() {
							let args = Array.from(arguments);
							try {
								return context['_' + functionName].apply(null, args);
							}
							catch(err) {
								args = [].slice.apply(arguments).concat([err.stack[1].trim()]);
								args.pop();
								mikser.diagnostics.log(context, 'error', functionName + '(' + args.join(', ') + ')\n  ' + err.stack.toString());
								throw err;
							}
						}
					}
				}
				context.mikser = mikser;
				context.content = engine.render(context);
			}
			mikser.diagnostics.leave(context);
		}
		catch (err) {
			if (err.origin) {
				let message = err.message;
				if (err.diagnose) {
					message = err.diagnose.message + '\n' + err.diagnose.details + '\n';
				}
				mikser.diagnostics.log(context, 'error', '[' + err.origin + '] ' + message);			
			} 
			else {
				mikser.diagnostics.log(context, 'error', err.stack.toString());				
			}
			mikser.diagnostics.break(context);
			throw err;
		}
		return context;
	};

	generator.renderShortcode = function (context) {
		let shortcodeDocumentContext = mikser.loader.extend(context);
		delete shortcodeDocumentContext.layout;
		shortcodeDocumentContext._id = context._id + '.0';
		mikser.diagnostics.splice(shortcodeDocumentContext);
		generator.render(shortcodeDocumentContext);

		let order = 1;
		for (let layout of shortcodeDocumentContext.layouts) {
			shortcodeDocumentContext.layout = layout;
			shortcodeDocumentContext._id = context._id + '.' + (order++).toString();
			context.layoutLink(layout);
			mikser.diagnostics.splice(shortcodeDocumentContext);
			generator.render(shortcodeDocumentContext);
		}
		context.content = shortcodeDocumentContext.content;
		return context;
	}

	generator.renderContext = function(context) {
		mikser.diagnostics.splice(context);
		return mikser.loader.loadSelf(context).then((context) => {
			let renderPipe = Promise.resolve(context);
			let shortcodes = require('shortcode-parser');
			renderPipe = renderPipe.then((context) => {
				let preparations = Promise.resolve();
				for (let shortcode in context.shortcodes) {
					//console.log('1.', shortcode, context.shortcodes[shortcode]._id);
					preparations = preparations.then(() => {
						let shortcodeContext = mikser.loader.extend(context);
						shortcodeContext.document.meta = extend({}, context.document.meta);
						delete shortcodeContext.document.meta.layout;
						delete shortcodeContext.layouts;
						shortcodeContext.layout = context.shortcodes[shortcode];
						return mikser.loader.loadSelf(shortcodeContext).then(() => {
							//console.log('2.', shortcodeContext.layouts.map((layout) => layout._id));
							let preload = Promise.resolve();
							for (let shortcodeLayout of shortcodeContext.layouts) {
								let shortcodeRenderContext = mikser.loader.extend(shortcodeContext);
								shortcodeRenderContext.layout = shortcodeLayout;
								preload = preload.then(() => {
									return mikser.loader.loadBlocks(shortcodeRenderContext).then(() => {
										// console.log('3.', shortcode, renderContext.layouts.map((layout) => layout._id));
										shortcodes.add(shortcode, (content, options) => {
											shortcodeRenderContext.content = S(content).trim().s;
											shortcodeRenderContext.options = options;
											return generator.renderShortcode(shortcodeRenderContext).content;
										});
									});
								});
							}
							return preload;
						});
					});
				}
				return preparations;
			});
			renderPipe = renderPipe.then(() => {
				context.content = shortcodes.parse(context.document.content);
				return generator.render(context);
			});

			let order = 1;
			for (let layout of context.layouts) {
				renderPipe = renderPipe.then((context) => {
					let renderContext = mikser.loader.extend(context);
					renderContext._id = (order++).toString();
					renderContext.layout = layout;
					mikser.diagnostics.splice(renderContext);
					return mikser.loader.loadBlocks(renderContext).then(() => {
						generator.render(renderContext);
						context.content = renderContext.content;
						mikser.loader.dispose(renderContext);
						return Promise.resolve(context);
					});
				});
			}
			return renderPipe;
		});
	}

	generator.renderDocument = function(documentId, strategy) {
		mikser.diagnostics.snapshot();
		if ('workerId' in mikser) debug('Render[' + mikser.workerId + ']:', strategy, documentId);
		else debug('Preview:', strategy, documentId);
		return using(mikser.database.connect(), (database) => {
			return database.findDocument({_id: documentId}).then((document) => {
				if (!document) return Promise.resolve();
				let context = {
					_id: '0',
					document: document,
					strategy: strategy,
					data: {},
					database: database
				}

				let documentLinks = [];
				context.documentLink = function(document) {
					if (documentLinks.indexOf(document._id) == -1) {
						documentLinks.push(document._id);
					}
				}

				let documentUnlinks = [];
				context.documentUnlink = function(document) {
					if (documentUnlinks.indexOf(document._id) == -1) {
						documentUnlinks.push(document._id);
					}
				}

				let layoutLinks = [];
				context.layoutLink = function(layout) {
					if (layoutLinks.indexOf(layout._id) == -1) {
						layoutLinks.push(layout._id);
					}
				}

				let layoutUnlinks = [];
				context.layoutUnlink = function(layout) {
					if (layoutUnlinks.indexOf(layout._id) == -1) {
						layoutUnlinks.push(layout._id);
					}
				}

				context.href = function (href, lang, link) {
					if (_.isBoolean(lang) && link == undefined) {
						link = lang;
						lang = undefined;
					}
					link = link || true;
					let found = mikser.runtime.findHref(context, href, lang);
					if (found && 
						found._id && 
						found._id != context.document._id && 
						found.meta.lang == context.document.meta.lang) {
						context.documentLink(found);
					}
					return found;
				}
				context.hrefPage = function (href, page, lang, link) {
					let found = context.href(href, lang, link);
					if (found && found._id && page > 0) {
						let href = found.toString();
						found.toString = () => {
							return href.replace(path.extname(found.url), '.' + page + '.html');
						}
					}
					return found;
				}
				context.hrefLang = function (href) {
					return mikser.runtime.findHrefLang(context, href);
				}

				let processPending = () => {};
				let pending = new Promise((resolve, reject) => {
					processPending = resolve;
				});
				context.process = function(action) {
					pending = pending.then(action);
					return pending;
				}

				if (strategy == constants.RENDER_STRATEGY_PREVIEW) {
					return generator.renderContext(context).then((context) => {
						pending.cancel();
						return Promise.resolve(context.content);
					});
				}
				let originalLinks;
				return mikser.runtime.cleanLinks(document, database).then((links) => {
					originalLinks = links;
					if (!document.destination) {
						if (strategy > constants.RENDER_STRATEGY_STANDALONE) {
							return mikser.runtime.followLinks(document, database, false);
						}
						return Promise.resolve();
					} 

					return generator.renderContext(context).then((context) => {
						return fs.createFileAsync(context.document.destination).then(() => {
							return fs.writeFileAsync(context.document.destination, context.content);							
						});
					}).then(() => {
						documentLinks = _.difference(documentLinks, documentUnlinks);
						layoutLinks = _.difference(layoutLinks, layoutUnlinks);
						return mikser.runtime.addLinks(document, documentLinks, layoutLinks, database).then(() => {
							if (strategy != constants.RENDER_STRATEGY_STANDALONE) {
								return mikser.runtime.followLinks(document, database, false);
							}
							return Promise.resolve();
						});
					}).then(() => {
						processPending();
						return pending.then(() => {
							mikser.loader.dispose(context);
						});
					}).then(() => {
						return Promise.resolve(document.destination);
					}).catch((err) => {
						if (fs.existsSync(document.destination)) {
							fs.removeSync(document.destination);
						}
						throw err;
					});
				}).catch((err) => {
					if (originalLinks) {
						return mikser.runtime.restoreLinks(originalLinks, database).then(() => {
							throw err;
						});
					}
					throw err;
				});
			});
		});
	};

	mikser.generator = generator;
	return Promise.resolve(mikser);
}