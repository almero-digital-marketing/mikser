'use strict'

var Promise = require('bluebird');
var using = Promise.using;
var path = require('path');
var glob = require('glob-promise');
var cluster = require('cluster');
var extend = require('node.extend');
var _ = require('lodash');
var fs = require("fs-extra-promise");
var yaml = require('js-yaml');
var S = require('string');
var exec = Promise.promisify(require('child_process').exec);
var constants = require('./constants.js');
var minimatch = require("minimatch");

module.exports = function(mikser) {
	var manager = {
	};
	mikser.config = extend({
		documentsPattern: '**/*',
		layoutsPattern: '**/*',
		pluginsPattern: '**/*',
		viewsPattern: '**/*',
		extensions: {},
		shared: [],
		compile: [],
		routes: [],
		sync: [],
		cleanUrls: false
	}, mikser.config);
	var debug = mikser.debug('manager');

	mikser.config.copyFolder = mikser.config.filesFolder;
	mikser.config.replicateFolder = mikser.config.sharedFolder;
	if (mikser.config.shared.length) {
		mikser.config.copyFolder = mikser.config.sharedFolder;
		mikser.config.replicateFolder = mikser.config.filesFolder;
	}

	function getExternalId(collection, entityId) {
		let metafileSource = path.join(mikser.config[collection + 'Folder'], entityId);
		let metafileDir = path.dirname(metafileSource);
		let metafileBasename = path.basename(metafileSource);
		let metafileExt = path.extname(metafileBasename);
		let metafileName = metafileBasename.replace(metafileExt, '');

		if (fs.existsSync(metafileSource)) {
			if (fs.statSync(metafileSource).isDirectory()) return;
		}

		if (!fs.existsSync(metafileDir)) return;
		let fileMatches = fs.readdirSync(metafileDir);
		fileMatches = fileMatches.filter((fileName) => {
			if (fileName === metafileBasename) return false;
			return fileName.replace(path.extname(fileName), '') === metafileName;
		});
		if (!fileMatches.length) return;

		for (let file of fileMatches) {
			let engine = mikser.generator.findEngine(file);
			if (engine) {
				let externalId = entityId.replace(metafileExt, path.extname(file))
				return S(externalId).replaceAll('\\','/').ensureLeft('/').s;
			};
		}
	}

	function getEntityInfo(collection, entityId) {
		entityId = S(entityId).replaceAll('\\','/').ensureLeft('/').s
		let isExternal = false;
		switch(collection) {
			case 'documents':
				isExternal = mikser.parser.findEngine(entityId);
				break;
			case 'layouts':
			case 'views':
				isExternal = !mikser.generator.findEngine(entityId)
				break;
		}

		let externalId;
		if (isExternal) {
			externalId = getExternalId(collection, entityId);
			if (externalId) {
				let tempId = entityId;
				entityId = externalId;
				externalId = tempId;
			}
		}

		var source = path.join(mikser.config[collection + 'Folder'], entityId);
		let stats = fs.statSync(source);

		if (externalId) {
			stats = fs.statSync(path.join(mikser.config[collection + 'Folder'], externalId));
		}

		return {
			_id: entityId,
			stats: stats,
			source: source
		}
	}

	manager.importDocument = function (documentId) {
		let entityInfo = getEntityInfo('documents', documentId);

		let sourceStat = entityInfo.stats;
		let source = entityInfo.source;
		documentId = entityInfo._id;

		if (sourceStat.isDirectory()) return Promise.resolve();
		let info = mikser.parser.parse(source);
		if (!info.meta || info.meta && !info.meta.layout) {
			for (let entry of mikser.config.layouts) {
				let match = documentId;
				if (info.meta && info.meta.href) match = info.meta.href;
				if (minimatch(match, entry.pattern)) {
					info.meta = info.meta || {};
					info.meta.href = info.meta.href || documentId;
					info.meta.layout = entry.layout;
					debug('Auto layout:', documentId, entry.layout);
					break;
				}
			}
		}

		let destination = mikser.utils.predictDestination(source, info);
		let document = {
			_id: documentId, 
			stamp: mikser.stamp,
			importDate: new Date(),
			source: source,
			collection: 'documents',
			pageNumber: 0,
			meta: info.meta || {},
			content: info.content,
			sourceExt: path.extname(path.basename(source)),
			mtime: sourceStat.mtime,
			atime: sourceStat.atime,
			ctime: sourceStat.ctime,
			birthtime: sourceStat.birthtime,
			size: sourceStat.size,
			url: mikser.utils.getUrl(destination)
		};
		if (destination) document.destination = destination;
		if (document.destination) document.destinationExt = path.extname(path.basename(document.destination));
		if (document.url) document.relativeBase = mikser.runtime.findHref(document, '/').link;

		let validateDestination = Promise.resolve(true);
		if (document.destination) {
			validateDestination = mikser.database.documents.findOne({ 
				$and: [
					{destination: document.destination},
					{_id: {$ne: document._id}}
				]}).then((matchedDocument) => {
				if (matchedDocument) {
					mikser.diagnostics.log('error', 'Destination collision', document._id + ' -> ' + matchedDocument._id);
					return Promise.resolve(false);
				}
				return Promise.resolve(true);
			});
		}

		return validateDestination.then((valid) => {
			if (valid) {
				let ckeckForChanges = function() {
					if (document.destination) {
						if (fs.existsSync(document.destination)) {
							let destinationStat = fs.statSync(document.destination);
							if (destinationStat.mtime > sourceStat.mtime) {
								return Promise.resolve(false);
							}
						}	
						return Promise.resolve(true);
					}
					else {
						return mikser.database.documents.findOne({_id: documentId}).then((recentDocument) => {
							if (recentDocument) {
								let sourceStat = fs.statSync(source);
								let schedule = recentDocument.importDate < sourceStat.mtime.getTime();
								// Delete destination if document used to have destination before but not any more.
								if (recentDocument.destination) {
									fs.removeSync(recentDocument.destination);
								}
								return Promise.resolve(schedule);
							}
							return Promise.resolve(true);
						});
					}
				};
				return mikser.emit('mikser.manager.importDocument', document).then(() => {
					return ckeckForChanges();
				}).then((schedule) => {
					return mikser.runtime.link(document).then(() => {
						return mikser.database.documents.save(document);
					}).then(() => {
						if (schedule && document.render !== false) {
							return mikser.scheduler.scheduleDocument(documentId, constants.RENDER_STRATEGY_FORCE);
						}
						return Promise.resolve();
					});
				});
			}
			return Promise.resolve();
		});
	};

	manager.importLayout = function (layoutId) {
		let entityInfo = getEntityInfo('layouts', layoutId);

		let sourceStat = entityInfo.stats;
		let source = entityInfo.source;
		layoutId = entityInfo._id;

		if (sourceStat.isDirectory()) return Promise.resolve();
		var schedule = false;

		return mikser.database.layouts.findOne({_id: layoutId}).then((layout) => {
			if (layout) {
				schedule = layout.importDate < sourceStat.mtime.getTime();
			} else {
				schedule = true;
			}
		}).then(() => {
			var info = mikser.parser.parse(source);
			if (info.meta) delete info.meta.href;
			let layout = {
				_id: layoutId,
				stamp: mikser.stamp,
				importDate: new Date(),
				source: source,
				collection: 'layouts',
				meta: info.meta || {},
				mtime: sourceStat.mtime,
				atime: sourceStat.atime,
				ctime: sourceStat.ctime,
				birthtime: sourceStat.birthtime,
				size: sourceStat.size,
				template: info.content
			}

			return mikser.emit('mikser.manager.importLayout', layout).then(() => {
				if (schedule) {
					return mikser.database.layouts.save(layout).then(() => {
						return mikser.scheduler.scheduleLayout(layoutId);
					});
				}
				return mikser.database.layouts.save(layout);
			});
		});
	}

	manager.importPlugin = function (pluginId) {
		pluginId = S(pluginId).replaceAll('\\','/').ensureLeft('/').s;
		var source = path.join(mikser.config.pluginsFolder, pluginId);
		let sourceStat = fs.statSync(source);
		if (sourceStat.isDirectory()) return Promise.resolve();
		var schedule = false;
		return mikser.database.plugins.findOne({_id: pluginId}).then((plugin) => {
			if (plugin) {
				schedule = plugin.importDate < sourceStat.mtime.getTime();
			} else {
				schedule = true;
			}
		}).then(() => {
			let plugin = {
				_id: pluginId,
				stamp: mikser.stamp,
				source: source,
				collection: 'plugins',
				importDate: new Date()
			}
			if (schedule) {
				return mikser.database.plugins.save(plugin).then(() => {
					return mikser.scheduler.schedulePlugin(pluginId);
				});
			}
			return mikser.database.plugins.save(plugin);
		});
	}

	manager.importView = function (viewId) {
		let entityInfo = getEntityInfo('views', viewId);

		let sourceStat = entityInfo.stats;
		let source = entityInfo.source;
		viewId = entityInfo._id;

		if (sourceStat.isDirectory()) return Promise.resolve();

		let info = mikser.parser.parse(source);
		let destination = mikser.utils.predictDestination(source, info);
		let view = {
			_id: viewId, 
			stamp: mikser.stamp,
			importDate: new Date(),
			source: source,
			collection: 'views',
			meta: info.meta || {},
			sourceExt: path.extname(path.basename(source)),
			mtime: sourceStat.mtime,
			atime: sourceStat.atime,
			ctime: sourceStat.ctime,
			birthtime: sourceStat.birthtime,
			size: sourceStat.size,
			url: mikser.utils.getUrl(destination),
		};
		view.meta.pick = view.meta.pick || 
			['body', 'headers', 'httpVersion', 'method', 'trailers', 'url', 'originalUrl', 'params', 'query'];
		return mikser.emit('mikser.manager.importView', view).then(() => {
			return mikser.database.views.save(view).then(() => {
				return mikser.runtime.link(view);
			});
		});
	}

	manager.deleteDocument = function (documentId) {

		let externalId;
		if (!mikser.generator.findEngine(documentId)) {
			externalId = getExternalId('documents',documentId);
			if (externalId) documentId = externalId;
		}
		documentId = S(documentId).replaceAll('\\','/').ensureLeft('/').s;

		if (externalId) {
			return mikser.database.documents.findOne({
				_id: documentId
			}).then((document) => {
				if (document && document.destination) {
					return fs.removeAsync(document.destination).then(() => {
						return mikser.database.documents.remove({_id: documentId});
					});
				}
			}).then(() => {
				return manager.importDocument(documentId);
			});
		} else {
			console.log('Delete:', documentId);
			return mikser.database.documents.findOne({_id: documentId}).then((document) => {
				if (!document) Promise.resolve();
				return mikser.emit('mikser.manager.deleteDocument', document).then(() => {
					return mikser.runtime.cleanLinks({_id: documentId}).then(() => {
						return mikser.database.documents.remove({_id: documentId});
					}).then(() => {
						return mikser.runtime.followLinks(document, true);
					}).then(() => {
						if (document.destination) {
							return fs.removeAsync(document.destination);
						}
					}).then(() => {				
						return mikser.runtime.unlink(document);
					});
				});
			});
		}
	};

	manager.deleteLayout = function (layoutId) {
		let externalId;
		if (!mikser.generator.findEngine(layoutId)) {
			externalId = getExternalId('layouts',layoutId);
			if (externalId) layoutId = externalId;
		}
		layoutId = S(layoutId).replaceAll('\\','/').ensureLeft('/').s;

		if (externalId) {
			return mikser.database.layouts.remove({
				_id: layoutId
			}).then(() => {
				return manager.importLayout(layoutId);
			});
		} else {
			console.log('Delete:', layoutId);
			return mikser.database.findLayout({_id: layoutId}).then((layout) => {
				if (!layout) Promise.resolve();
				return mikser.emit('mikser.manager.deleteLayout', layout).then(() => {
					return mikser.scheduler.scheduleLayout(layoutId).then(() => {
						return mikser.database.layouts.remove({
							_id: layoutId
						});
					});
				});
			});
		}

	};

	manager.deletePlugin = function (pluginId) {
		pluginId = S(pluginId).replaceAll('\\','/').ensureLeft('/').s;
		console.log('Delete:', pluginId);
		return mikser.scheduler.schedulePlugin(pluginId).then(() => {
			return mikser.database.plugins.remove({
				_id: pluginId
			});
		});
	};

	manager.deleteView = function (viewId) {
		let externalId;
		if (!mikser.generator.findEngine(viewId)) {
			externalId = getExternalId('views',viewId);
			if (externalId) viewId = externalId;
		}
		viewId = S(viewId).replaceAll('\\','/').ensureLeft('/').s;

		if (externalId) {
			return mikser.database.views.findOne({
				_id: viewId
			}).then((view) => {
				if (view && view.destination) {
					return fs.removeAsync(view.destination).then(() => {
						return mikser.database.views.remove({_id: viewId});				
					});
				}
			}).then(() => {
				return manager.importView(viewId);
			});
		} else {
			console.log('Delete:', viewId);
			return mikser.database.views.findOne({_id: viewId}).then((view) => {
				if (!view) Promise.resolve();
				return mikser.emit('mikser.manager.deleteView', view).then(() => {
					return mikser.runtime.cleanLinks({_id: viewId}).then(() => {
						return mikser.database.views.remove({_id: viewId});
					}).then(() => {
						return mikser.runtime.followLinks(view, true);
					}).then(() => {
						return mikser.runtime.unlink(view);
					});
				});
			});
		}
	}

	if (cluster.isMaster) {
		manager.glob = function () {
			return Promise.resolve()
				.then(() => {
					return glob(mikser.config.documentsPattern, { cwd: mikser.config.documentsFolder });
				})
				.then((files) => {
					return Promise.map(files, (file) => {
						return manager.importDocument(file);
					}, {
						concurrency: mikser.config.workers
					});
				})
				.then((result) => {
					console.log('Documents:', result.length);
				})
				.then(() => {
					return glob(mikser.config.layoutsPattern, { cwd: mikser.config.layoutsFolder });
				})
				.then((files) => {
					return Promise.map(files, (file) => {
						return manager.importLayout(file);
					}, {
						concurrency: mikser.config.workers
					});
				})
				.then((result) => {
					console.log('Lyouts:', result.length);
				})
				.then(() => {
					return glob(mikser.config.pluginsPattern, { cwd: mikser.config.pluginsFolder });
				})
				.then((files) => {
					return Promise.map(files, (file) => {
						return manager.importPlugin(file);
					});
				})
				.then((result) => {
					console.log('Custom plugins:', result.length);
				}).then(() => {
					return glob(mikser.config.viewsPattern, { cwd: mikser.config.viewsFolder });
				})
				.then((files) => {
					return Promise.map(files, (file) => {
						return manager.importView(file);
					});
				})
				.then((result) => {
					console.log('Views:', result.length);
					return mikser.emit('mikser.manager.glob').then(() => {
						return mikser.observer.start();
					})
				});
		};

		manager.clean = function () {
			return mikser.database.findDocuments({
				stamp: { $lt: mikser.stamp },
				pageNumber: 0
			}).then((documents) => {
				return Promise.map(documents, (document) => {
					return manager.deleteDocument(document._id);
				}, {concurrency: mikser.config.workers});
			}).then(() => {
				return mikser.database.findLayouts({stamp: { $lt: mikser.stamp }}).then((layouts) => {
					return Promise.map(layouts, (layout) => {
						return manager.deleteLayout(layout._id);
					}, {concurrency: mikser.config.workers});
				});
			}).then(() => {
				return mikser.database.findPlugins({stamp: { $lt: mikser.stamp }}).then((plugins) => {
					return Promise.map(plugins, (plugin) => {
						return manager.deletePlugin(plugin._id);
					}, {concurrency: mikser.config.workers});
				});
			}).then(() => {
				return mikser.database.findPlugins({stamp: { $lt: mikser.stamp }}).then((plugins) => {
					return Promise.map(plugins, (plugin) => {
						return manager.deletePlugin(plugin._id);
					}, {concurrency: mikser.config.workers});
				});
			}).then(() => {
				return Promise.resolve();
			});
		};

		manager.sync = function() {
			let commands = fs.ensureDirAsync(mikser.config.outputFolder).then(() => {
				console.log('Syncronizing files');
				console.log('  ' + mikser.config.copyFolder);
				return mikser.tools.syncFolders(mikser.config.copyFolder, mikser.config.outputFolder);
			});

			if (mikser.config.documentsPattern != '*/**') {
				commands = commands.then(() => {
					return fs.copyAsync(mikser.config.documentsFolder, mikser.config.outputFolder, {
						clobber: true,
						filter: (source) => {
							if (minimatch(source, mikser.config.documentsPattern)) return false;
							let destination = source.replace(mikser.config.documentsFolder, mikser.config.outputFolder);
							if (!fs.existsSync(destination)) return true;
							let sourceStat = fs.statSync(source);
							let destinationStat = fs.statSync(destination);
							return destinationStat.mtime < sourceStat.mtime;
						}
					});
				});
			}

			if (fs.existsSync(mikser.config.replicateFolder)) {
				console.log('Replicating files')
				for(let replica of mikser.config.shared) {
					let destination = path.join(mikser.config.outputFolder, replica);
					console.log('  ' + replica);
					commands = commands.then(() => {
						return mikser.tools.syncFolders(mikser.config.replicateFolder, destination);
					});
				}
			}

			if (mikser.config.sync.length) {
				console.log('Syncronizing external files')
			}
			for (let sync of mikser.config.sync) {
				let syncDestination, syncSource;
				if (typeof sync == 'string') {
					console.log('  ' + sync);
					syncSource = path.join(mikser.options.workingFolder, sync);
				} else {
					if (sync.source.indexOf('/.svn/') == -1 && sync.source.indexOf('/.git/') != -1) {
						let outDestination = path.join(mikser.config.outputFolder, sync.destination).replace(mikser.options.workingFolder,'');
						console.log('  ' + sync.source + ' -> ' + outDestination);
						syncSource = path.join(mikser.options.workingFolder, sync.source);
						syncDestination = sync.destination;
					}
				}
				if (!syncDestination) {
					if (mikser.config.shared.length) {
						for(let replica of mikser.config.shared) {
							let replicaDestination = path.join(mikser.config.outputFolder, replica);
							let destination = replicaDestination;
							commands = commands.then(() => {
									return mikser.tools.syncFolders(syncSource, destination);
							});	
						}
					} else {
						commands = commands.then(() => {
							let destination = mikser.config.outputFolder;
							return mikser.tools.syncFolders(syncSource, destination);
						});	
					}
				} else {
					let destination = path.join(mikser.config.outputFolder, syncDestination);
					commands = commands.then(() => {
						return mikser.tools.syncFolders(syncSource, destination);
					});					
				}
			}
			return commands.then(() => {
				return mikser.emit('mikser.manager.sync')
			});
		};

	}

	mikser.manager = manager;
	return fs.ensureDirAsync(mikser.config.filesFolder).then(() => {
		return fs.ensureDirAsync(mikser.config.outputFolder);
	}).then(() => {
		return fs.ensureDirAsync(mikser.config.documentsFolder);
	}).then(() => {
		return fs.ensureDirAsync(mikser.config.layoutsFolder);
	}).then(() => Promise.resolve(mikser));
}