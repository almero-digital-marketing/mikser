'use strict'

var Promise = require('bluebird');
var path = require('path');
var cluster = require('cluster');
var extend = require('node.extend');
var S = require('string');
var fs = require("fs-extra-promise");
var minimatch = require("minimatch");
var _ = require('lodash');
var using = Promise.using;
var constants = require('./constants.js');
var check = require('syntax-error');
var indentString = require('indent-string');
var yaml = require('js-yaml');
var JSON5 = require('json5');
var util = require('util');
var vm = require('vm');
var hasha = require('hasha');
var requireNew = require('require-new')

module.exports = function(mikser) {
	mikser.config = extend({
		queryPattern: '**/*.query'
	}, mikser.config);
	mikser.loader = {};
	var debug = mikser.debug('loader');

	mikser.loader.extend = function(context) {
		let branch = extend({}, context);
		context.branches.push(branch);
		branch.branches = [];
		return branch;
	}

	mikser.loader.dispose = function(context) {
		if (context.layout) {
			for(let name in context.layout.meta.data) {
				if (!context.layout.meta.data[name].keep) {
					debug('Offload data:', name, context.layout._id);
					delete context.data[name];
				}
			}			
		}

		for (let branch in context.branches) {
			mikser.loader.dispose(context.branches[branch]);
			delete context.branches[branch];
		}

		if (context._id == 0) {
			for(let name in context.blocks) {
				delete context.blocks[name];
			}
			for(let name in context.partials) {
				delete context.partials[name];
			}
			for(let name in context.data) {
				delete context.data[name];
			}
			for(let name in context.layouts) {
				delete context.layouts[name];
			}
		}

		for (let name in context) {
			delete context[name];
		}
	}

	mikser.loader.loadLayouts = function(context) {
		if (!context.layouts) {
			context.layouts = [];
			if (context.layout) {
				var layoutId = context.layout._id;
			}
			else if (context.document && context.document.meta) {
				var layoutId = context.document.meta.layout;
			}
		}
		else {
			let lastLayout = context.layouts[context.layouts.length - 1];
			if (lastLayout.meta && lastLayout.meta.layout) {
				var layoutId = lastLayout.meta.layout;
			}
		}
		if (layoutId) {
			return context.database.findLayout({_id: layoutId}).then((layout) => {
				if (layout) {
					context.layouts.push(layout);
					return mikser.loader.loadLayouts(context);
				}
				else {
					throw new Error('Layout missing: ' + layoutId);
				}
			});
		}
		return Promise.resolve(context);
	};

	mikser.loader.loadPartials = function (context) {
		context.partials = {};
		if (context.layout.meta && context.layout.meta.partials) {
			let order = 1;
			return Promise.map(_.keys(context.layout.meta.partials), (name) => {
				if (context.partials[name]) return;
				context.partials[name] = () => '';
				let partialName = context.layout.meta.partials[name];
				let partialContext = mikser.loader.extend(context);
				return context.database.findLayout({ _id: partialName }).then((layout) => {
					if (!layout) {
						context.partials[name] = function() {
							throw 'Partial layout missing: ' + partialName;
						}
						return Promise.resolve();
					}
					delete partialContext.layouts;
					partialContext.layout = layout;
					return mikser.loader.loadSelf(partialContext).then(() => {
						let preparations = Promise.resolve();
						for (let layout of partialContext.layouts) {
							partialContext.layout = layout;
							preparations = preparations.then(() => {
								return mikser.loader.loadPartials(partialContext).then(() => {
									return mikser.loader.loadBlocks(partialContext);
								});
							});
						}
						
						return preparations.then(() => {
							context.partials[name] = function (options) {
								partialContext.options = options;
								for (let layout of partialContext.layouts) {
									partialContext._id = context._id + '-p.' + (order++).toString();
									partialContext.layout = layout;
									mikser.diagnostics.splice(partialContext);
									mikser.generator.render(partialContext);
								}				
								return partialContext.content;
							};
							return Promise.resolve();
						});
					});
				});
			}).then(() => context);
		}
		return Promise.resolve(context);
	}


	mikser.loader.loadBlocks = function (context, self) {
		if (context.layout.meta && context.layout.meta.blocks) {
			let order = 1;
			return Promise.map(_.keys(context.layout.meta.blocks), (name) => {
				let blockName = context.layout.meta.blocks[name];
				let blockContext = mikser.loader.extend(context);
				if (context.blocks[name] && !self) {
					return Promise.resolve();
				}
				return context.database.findLayout({ _id: blockName }).then((layout) => {
					if (!layout) {
						context.blocks[name] = function() {
							throw 'Block layout missing: ' + blockName;
						}
						return Promise.resolve();
					}
					delete blockContext.layouts;
					blockContext.layout = layout;
					return mikser.loader.loadSelf(blockContext).then(() => {
						let preparations = Promise.resolve();
						for (let layout of blockContext.layouts) {
							blockContext.layout = layout;
							preparations = preparations.then(() => {
								return mikser.loader.loadPartials(blockContext).then(() => {
									return mikser.loader.loadBlocks(blockContext, true);
								});
							});
						}
						
						return preparations.then(() => {
							context.blocks[name] = function (options) {
								blockContext.options = options;
								for (let layout of blockContext.layouts) {
									blockContext._id = context._id + '-b.' + (order++).toString();
									blockContext.layout = layout;
									mikser.diagnostics.splice(blockContext);
									mikser.generator.render(blockContext);
								}				
								return blockContext.content;
							};
							return Promise.resolve();
						});
					});
				});
			}).then(() => context);
		}
		return Promise.resolve(context);
	}

	mikser.loader.loadShortcodes = function (context) {
		context.shortcodes = context.shortcodes || {};
		let loadShortcodes = [];
		for(let layout in context.layouts) {
			if (context.layout.meta && context.layout.meta.shortcodes) {
				for (let shortcodeName in context.layout.meta.shortcodes) {
					let shortcode = context.layout.meta.shortcodes[shortcodeName];
					loadShortcodes.push(context.database.findLayout({ _id: shortcode }).then((layout) => {
						context.shortcodes[shortcodeName] = layout;
					}));
				}
			}
		}
		return Promise.all(loadShortcodes);
	}

	mikser.loader.loadPlugin = function(context, plugin) {
		let pluginName = plugin;
		if (context.plugins[S(pluginName).camelize().s]) return Promise.resolve();
		plugin = mikser.runtime.findPlugin(plugin);
		try {
			if (plugin.indexOf(mikser.config.pluginsFolder) == 0 || mikser.options.debug) {
				plugin = requireNew(plugin);
			} else {
				plugin = require(plugin);				
			}
		}
		catch(err) {
			try {
				let pluginFile = require('resolve').sync(plugin, { basedir: __dirname });
				let pluginSource = fs.readFileSync(pluginFile);
				let diagnose = check(pluginSource, pluginFile);
				if (diagnose) {
					mikser.diagnostics.log(context, 'error', '[' + pluginName + '] Plugin failed ' + diagnose.toString());
				} else {
					mikser.diagnostics.log(context, 'error', '[' + pluginName + '] Plugin failed ' + err.stack.toString());
				}				
			} catch(err) {
				mikser.diagnostics.log(context, 'error', '[' + pluginName + '] Plugin failed ' + err);
			}
			return Promise.resolve();
		}
		return Promise.resolve(plugin(mikser, context)).then((loadedPlugin) => {
			context.plugins[S(pluginName).camelize().s] = loadedPlugin;
			mikser.diagnostics.log(context, 'info', '[' + pluginName + '] Plugin loaded');
		});
	};

	mikser.loader.loadPlugins = function (context) {
		context.plugins = context.plugins || {};
		let loadPlugins = [];
		if (context.layout) {
			if (!context.layout.meta) console.log(context.layout._id, context.layout);
			if (context.layout.meta.plugins) {
				for(let pluginName of context.layout.meta.plugins) {
					loadPlugins.push(mikser.loader.loadPlugin(context, pluginName));
				}
			}			
		}
		return Promise.all(loadPlugins).then(() => context);
	}

	mikser.loader.loadData = function (context) {
		return Promise.map(_.keys(context.layout.meta.data), (name) => {
			let queryInfo = context.layout.meta.data[name];
			if (_.isArray(queryInfo)) {
				context.data[name] = queryInfo;
				return Promise.resolve(context);
			}
			let query = {};
			let orderBy = {};
			let cache = true;
			if (typeof queryInfo == 'string' && minimatch(queryInfo, mikser.config.queryPattern)) {
				queryInfo = { query: queryInfo };
			}
			if (!queryInfo.layout && !queryInfo.query) {
				query = {'meta.layout': queryInfo};
				if (context.document.meta.lang) {
					query = {
						'meta.layout': queryInfo,
						'meta.lang': context.document.meta.lang
					};					
				}
			}
			else {
				query = {'meta.layout': queryInfo.layout};
				if (context.document.meta.lang) {
					query['meta.lang'] = context.document.meta.lang;
				}
				if (queryInfo.query) {
					if (typeof queryInfo.query == 'string') {
						let queryFile;
						try {
							if (minimatch(queryInfo.query, mikser.config.queryPattern)) {
								queryFile = mikser.utils.findSource(queryInfo.query);
								if (queryFile){
									queryInfo.query = fs.readFileSync(queryFile, { encoding: 'utf8' });
								}
							}
							var queryContext = new vm.createContext(context);
							var queryScript = new vm.Script('query = ' + queryInfo.query);
							queryScript.runInContext(queryContext);							
						}
						catch(err) {
							try {
								let diagnose = check(queryInfo.query, queryFile);
								if (diagnose) {
									mikser.diagnostics.log(context, 'error', '[' + name + '] Query failed ' + diagnose.toString());
								} else {
									mikser.diagnostics.log(context, 'error', '[' + name + '] Query failed ' + err.stack.toString());
								}				
							} catch(err) {
								mikser.diagnostics.log(context, 'error', '[' + name + '] Query failed ' + err);
							}
							return Promise.resolve();
						}

						query = context.query;
						debug('Query:', S(JSON5.stringify(query)).lines().map((line) => S(line).trim().s).join(' '));
						delete context.query;
						queryInfo.cache = queryInfo.cache || false;
					}
					else {
						query = queryInfo.query;
					}
				}
				if (queryInfo.orderBy) {
					if (typeof queryInfo.orderBy == 'string') {
						orderBy[queryInfo.orderBy] = 1;
					}
					else {
						orderBy[queryInfo.orderBy.field] = queryInfo.orderBy.order;
					}
				}
				if (queryInfo.cache != undefined) {
					cache = queryInfo.cache;
				}
			}

			if (cache) {
				let cacheId = hasha(JSON5.stringify({ query: query, orderBy: orderBy }), {algorithm: 'md5'});
				var loadData = mikser.runtime.fromCache(cacheId, () => {
					return context.database.findDocuments(query, orderBy);
				});

			} else {
				var loadData = context.database.findDocuments(query, orderBy);
			}

			return loadData.then((data) => {
				if (data.length == 0) {
					if (queryInfo.empty == undefined) {
						mikser.diagnostics.log(context, 'warning', '[' + name + '] Data loaded: Empty\n' + S(indentString(yaml.dump(context.layout.meta.data[name]), ' ', 2)).trimRight().s);
					}
					else if (queryInfo.empty == false) {
						mikser.diagnostics.log(context, 'error', '[' + name + '] Data loaded: Empty\n' + S(indentString(yaml.dump(context.layout.meta.data[name]), ' ', 2)).trimRight().s);
					}
				}
				else {
					mikser.diagnostics.log(context, 'info', '[' + name + '] Data loaded: ' + data.length);
				}
				if (context.data[name] && !queryInfo.keep) mikser.diagnostics.log(context, 'warning', '[' + name + '] Data collision');
				context.data[name] = data;
			});
		}).then(() => context);
	}

	mikser.loader.loadPages = function (context) {
		let loadPages = Promise.resolve();
		if (!context.paging && context.layout.meta.pageBy && context.layout.meta.pageSize) {
			context.paging = {};
			Object.defineProperty(context.paging, 'prev', {
				get: function() {
					if (context.document.pageNumber > 2) {
						return context.document.meta.href.replace('/' + context.document.pageNumber,'/' + (context.document.pageNumber - 1));
					} 
					else if (context.document.pageNumber == 1) {
						return context.document.meta.href.replace('/1','');
					}
				}
			});
			Object.defineProperty(context.paging, 'next', {
				get: function() {
					if (context.document.pageNumber < context.paging.pages - 1) {
						if (context.document.pageNumber == 0) {
							return context.document.meta.href + '/' + (context.document.pageNumber + 1);
						}
						return context.document.meta.href.replace('/' + context.document.pageNumber,'/' + (context.document.pageNumber + 1));
					} 
				}
			});
			Object.defineProperty(context.paging, 'data', {
				get: function() {
					let pageData = context.data[context.layout.meta.pageBy].slice(
						context.layout.meta.pageSize * context.document.pageNumber, 
						context.layout.meta.pageSize * context.document.pageNumber + pageSize);
					return pageData;
				}
			});
			Object.defineProperty(context.paging, 'current', {
				get: function() {
					return context.document.pageNumber;
				}
			});
			context.paging.page = function(pageNumber) {
				if (pageNumber == 0) {
					return context.document.meta.href.replace('/' + context.document.pageNumber, '');
				}
				return context.document.meta.href.replace('/' + context.document.pageNumber, pageNumber);
			}
			context.paging.pages = Math.ceil(context.data[context.layout.meta.pageBy].length / context.layout.meta.pageSize);
			if (context.document.pageNumber == 0) {
				loadPages = context.database.findDocuments({
					source: context.document.source,
					pageNumber: { $gte: context.paging.pages }
				}).then((pages) => {
					return Promise.map(pages, (page) => {
						if (page.pageNumber > 0) {
							mikser.runtime.unlink(page);
							return mikser.manager.deleteDocument(page._id);
						}
						return Promise.resolve();
					}, {concurrency: 1});
				}).then(() => {
					let imports = [];
					for (let pageNumber = 1; pageNumber < context.paging.pages; pageNumber++) {
						let page = extend(true, {}, context.document);
						page.pageNumber = pageNumber;
						page._id += "." + pageNumber;
						page.meta.href = context.document.meta.href + '/' + pageNumber;

						if (mikser.config.cleanUrls) {
							page.destination = page.destination.replace('index.html', pageNumber + '/index.html');
						} else {
							let dir = path.dirname(page.destination);
							let basename = path.basename(page.destination);
							basename = basename.replace('.', '.' + pageNumber + '.');
							page.destination = path.join(dir, basename);
						}
						page.url = mikser.utils.getUrl(page.destination);
						imports.push(mikser.runtime.importDocument(page, context.strategy, context.database));
					}
					return Promise.all(imports);
				});
			}
		}
		return loadPages.then(() => context);
	};

	mikser.loader.loadSelf = function (context) {
		context.branches = context.branches || [];
		return mikser.loader.loadLayouts(context).then((context) => {
			let loadChain = mikser.loader.loadPlugins(context);
			for (var i = context.layouts.length - 1; i >= 0; i--) {
				let layout = context.layouts[i];
				loadChain = loadChain.then(() => {
					context.layout = layout;
					return Promise.resolve().then(() => {
						return mikser.loader.loadData(context);
					}).then(() => {
						return mikser.loader.loadPlugins(context);
					}).then(() => {
						return mikser.loader.loadShortcodes(context);
					});
				});
			};
			for (var i = 0; i < context.layouts.length; i++) {
				let layout = context.layouts[i];
				loadChain = loadChain.then(() => {
					return Promise.resolve().then(() => {
						return mikser.loader.loadPages(context);
					});
				});
			}
			return loadChain.then(() => {
				delete context.layout;
			});
		}).then(() => context);
	};

	return Promise.resolve(mikser);
}