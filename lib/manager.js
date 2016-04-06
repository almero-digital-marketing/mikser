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



	manager.importDocument = function (documentId, database) {
		documentId = S(documentId).replaceAll('\\','/').ensureLeft('/').s;
		let source = path.join(mikser.config.documentsFolder, documentId);
		let sourceStat = fs.statSync(source);
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
				}
			}
		}

		let destination = manager.predictDestination(source, info);
		let document = {
			_id: documentId, 
			stamp: mikser.stamp,
			importDate: new Date(),
			source: source,
			pageNumber: 0,
			meta: info.meta || {},
			content: info.content,
			sourceExt: path.extname(path.basename(source)),
			mtime: sourceStat.mtime,
			atime: sourceStat.atime,
			ctime: sourceStat.ctime,
			birthtime: sourceStat.birthtime,
			size: sourceStat.size,
			destination: destination,
			url: manager.getUrl(destination)
		};
		if (document.destination) document.destinationExt = path.extname(path.basename(document.destination));
		if (document.url) document.relativeBase = mikser.runtime.findHref({document: document}, '/').link;

		let inspect = (database) => {
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
					return database.documents.findOne({_id: documentId}).then((recentDocument) => {
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
					return database.documents.save(document);
				}).then(() => {
					if (schedule) {
						return mikser.scheduler.scheduleDocument(documentId, constants.RENDER_STRATEGY_FORCE);
					}
					return Promise.resolve();
				});
			});
		}

		if (!database) {
			return using(mikser.database.connect(), inspect);
		}
		return inspect(database);
	};

	manager.importLayout = function (layoutId, database) {
		layoutId = S(layoutId).replaceAll('\\','/').ensureLeft('/').s;
		var source = path.join(mikser.config.layoutsFolder, layoutId);
		let sourceStat = fs.statSync(source);
		if (sourceStat.isDirectory()) return Promise.resolve();
		var schedule = false;
		let inspect = (database) => {
			return database.layouts.findOne({_id: layoutId}).then((layout) => {
				if (layout) {
					schedule = layout.importDate < sourceStat.mtime.getTime();
				} else {
					schedule = true;					
				}
			}).then(() => {
				var info = mikser.parser.parse(source);
				let layout = {
					_id: layoutId,
					stamp: mikser.stamp, 
					importDate: new Date(),
					source: source,
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
						return database.layouts.save(layout).then(() => {
							return mikser.scheduler.scheduleLayout(layoutId);
						});
					}
					return database.layouts.save(layout);
				});
			});
		}
		if (!database) {
			return using(mikser.database.connect(), inspect);
		}
		return inspect(database);
	}

	manager.importPlugin = function (pluginId, database) {
		pluginId = S(pluginId).replaceAll('\\','/').ensureLeft('/').s;
		var source = path.join(mikser.config.pluginsFolder, pluginId);
		let sourceStat = fs.statSync(source);
		if (sourceStat.isDirectory()) return Promise.resolve();
		var schedule = false;
		let inspect = (database) => {
			return database.plugins.findOne({_id: pluginId}).then((plugin) => {
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
					importDate: new Date()
				}
				if (schedule) {
					return database.plugins.save(plugin).then(() => {
						return mikser.scheduler.schedulePlugin(pluginId);
					});
				}
				return database.plugins.save(plugin);
			});
		}
		if (!database) {
			return using(mikser.database.connect(), inspect);
		}
		return inspect(database);
	}

	manager.importView = function (viewId) {
		viewId = S(viewId).replaceAll('\\','/').ensureLeft('/').s;
		let source = path.join(mikser.config.documentsFolder, viewId);
		let sourceStat = fs.statSync(source);
		if (sourceStat.isDirectory()) return Promise.resolve();

		let info = mikser.parser.parse(source);
		let destination = manager.predictDestination(source, info);
		let view = {
			_id: viewId, 
			stamp: mikser.stamp,
			importDate: new Date(),
			source: source,
			meta: info.meta || {},
			sourceExt: path.extname(path.basename(source)),
			mtime: sourceStat.mtime,
			atime: sourceStat.atime,
			ctime: sourceStat.ctime,
			birthtime: sourceStat.birthtime,
			size: sourceStat.size,
			destination: destination,
			url: manager.getUrl(destination),
			destinationExt: path.extname(path.basename(view.destination))
		};
		return mikser.emit('mikser.manager.importView', view).then(() => {
			return mikser.runtime.link(view);
		});
	}

	manager.deleteDocument = function (documentId) {
		documentId = S(documentId).replaceAll('\\','/').ensureLeft('/').s;
		console.log('Delete:', documentId);
		return using(mikser.database.connect(), (database) => {
			return database.documents.findOne({_id: documentId}).then((document) => {
				if (!document) Promise.resolve();
				return mikser.emit('mikser.manager.deleteDocument', document).then(() => {
					return mikser.runtime.cleanLinks({_id: documentId}, database).then(() => {
						return database.documents.remove({_id: documentId});
					}).then(() => {
						return mikser.runtime.followLinks(document, database, true);
					}).then(() => {
						if (document.destination) {
							return fs.remove(document.destination);
						}
						return mikser.runtime.unlink(document);
					});
				});
			});
		});
	};

	manager.deleteLayout = function (layoutId) {
		layoutId = S(layoutId).replaceAll('\\','/').ensureLeft('/').s;
		console.log('Delete:', layoutId);
		return using(mikser.database.connect(), (database) => {
			return mikser.database.findLayout({_id: layoutId}).then((layout) => {
				if (!layout) Promise.resolve();
				return mikser.emit('mikser.manager.deleteLayout', layout).then(() => {
					return mikser.scheduler.scheduleLayout(layoutId).then(() => {
						return database.layouts.remove({
							_id: layoutId
						});
					});
				})
			});
		});
	};

	manager.deletePlugin = function (pluginId) {
		pluginId = S(pluginId).replaceAll('\\','/').ensureLeft('/').s;
		console.log('Delete:', pluginId);
		return mikser.scheduler.schedulePlugin(pluginId).then(() => {
			return using(mikser.database.connect(), (database) => {
				return database.plugins.remove({
					_id: pluginId
				});
			});
		});
	};

	manager.deleteView = function (viewId) {
		viewId = S(viewId).replaceAll('\\','/').ensureLeft('/').s;
		console.log('Delete:', viewId);
		return mikser.emit('mikser.manager.deleteView', view).then(() => {
			return mikser.runtime.unlink({_id: viewId});
		});		
	}

	if (cluster.isMaster) {
		manager.glob = function () {
			return using(mikser.database.connect(), (database) => {
				return Promise.resolve()
					.then(() => {
						return glob(mikser.config.documentsPattern, { cwd: mikser.config.documentsFolder });
					})
					.then((files) => {
						return Promise.map(files, (file) => {
							return manager.importDocument(file, database);
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
							return manager.importLayout(file, database);
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
							return manager.importPlugin(file, database);
						});
					})
					.then((result) => {
						console.log('Custom plugins:', result.length);
					}).then(() => {
						return glob(mikser.config.viewsPattern, { cwd: mikser.config.viewsFolder });
					})
					.then((files) => {
						return Promise.map(files, (file) => {
							return manager.importView(file, database);
						});
					})
					.then((result) => {
						console.log('Views:', result.length);
					});
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
					console.log('  ' + sync.source);
					syncSource = path.join(mikser.options.workingFolder, sync.source);
					syncDestination = sync.destination;
				}
				if (mikser.config.shared.length) {
					for(let replica of mikser.config.shared) {
						let replicaDestination = path.join(mikser.config.outputFolder, replica);
						let destination = replicaDestination;
						if (syncDestination) {
							destination = path.join(replicaDestination, syncDestination);
						}
						commands = commands.then(() => {
							return mikser.tools.syncFolders(syncSource, destination);
						});	
					}
				} else {
					commands = commands.then(() => {
						let destination = mikser.config.outputFolder;
						if (syncDestination) {
							destination = path.join(mikser.config.outputFolder, syncDestination);
						}
						return mikser.tools.syncFolders(syncSource, destination);
					});	
				}		
			}
			return commands;
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