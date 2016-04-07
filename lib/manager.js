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
		extensions: {
			default: '.html'
		}
	};
	mikser.config = extend({
		documentsPattern: '**/*',
		layoutsPattern: '**/*',
		pluginsPattern: '**/*',
		extensions: {},
		shared: [],
		compile: [],
		routes: [],
		sync: [],
		cleanUrls: false
	}, mikser.config);
	if (mikser.config.extensions) manager.extensions = _.defaultsDeep(mikser.config.extensions, manager.extensions);
	var debug = mikser.debug('manager');

	mikser.config.copyFolder = mikser.config.filesFolder;
	mikser.config.replicateFolder = mikser.config.sharedFolder;
	if (mikser.config.shared.length) {
		mikser.config.copyFolder = mikser.config.sharedFolder;
		mikser.config.replicateFolder = mikser.config.filesFolder;
	}

	manager.findSource = function (source) {
		let sourceFilePath = '';
		if (fs.existsSync(path.join(mikser.config.filesFolder, source))) {
			sourceFilePath = path.join(mikser.config.filesFolder, source);
		}
		else if (fs.existsSync(path.join(mikser.config.documentsFolder, source))) {
			sourceFilePath = path.join(mikser.config.documentsFolder, source);
		}
		else if (fs.existsSync(path.join(mikser.config.sharedFolder, source))) {
			sourceFilePath = path.join(mikser.config.sharedFolder, source);
		}
		else if (fs.existsSync(path.join(mikser.options.workingFolder, source))) {
			sourceFilePath = path.join(mikser.options.workingFolder, source);
		}
		else if (fs.existsSync(source)) {
			sourceFilePath = source;
		}
		return sourceFilePath;
	}

	manager.isPathToFile = function (destination) {
		let endingChar = destination.slice(-1);
		if (endingChar === '\\' || endingChar === '/') return false;
		if (fs.existsSync(destination) && fs.isDirectorySync(destination)) return false;
		let extName = path.extname(destination);
		// if this is not a directory or it is not ending on / || \, we check for file extension
		return (extName !== '' && extName !== '.');
	}

	manager.isNewer = function (source, destination) {
		if (!fs.existsSync(destination)) return true;
		let destinationMtime = fs.statSync(destination).mtime;

		if (!Array.isArray(source)) {
			var sources = [sources];
		} else {
			var sources = source;
		}

		for (let file of sources) {
			if (fs.statSync(file).mtime > destinationMtime) return true;
		}
		return false;
	}

	manager.resolveDestination = function (destination, anchor) {
		let destinationFolder = path.dirname(anchor);
		let share = manager.getShare(anchor);
		if (path.isAbsolute(destination)) {
			destination = destination.replace(mikser.config.outputFolder, '');
			if (share && destination.indexOf(share) != 0) {
				destinationFolder = path.join(mikser.config.outputFolder, share);
			}
			else {
				destinationFolder = mikser.config.outputFolder;
			}
		}
		return path.join(destinationFolder, destination);
	}

	manager.predictDestination = function (file, info) {
		// file is absolute path for root /home/user/path/to/file
		if (file.indexOf(mikser.config.documentsFolder) === 0 && 
			minimatch(file, mikser.config.documentsPattern)) {
			if (!info) info = mikser.parser.parse(file);
			if (info.meta && info.meta.destination && info.meta.render !== false) {
				return path.join(mikser.config.outputFolder, info.meta.destination);
			}
			// if current file is in documentsFolder, remove that path
			file = file.replace(mikser.config.documentsFolder, '').substring(1);
			let dir = path.dirname(file);
			let basename = path.basename(file);
			let sourceExt = path.extname(basename);
			let destinationExt = sourceExt;

			if (info.markup) {
				destinationExt = mikser.config.extensions.default;
			} else {
				destinationExt = mikser.manager.extensions[sourceExt] || destinationExt;
			}

			basename = basename.substr(0, basename.indexOf(".")) + destinationExt;
			let destination = path.join(mikser.config.outputFolder, dir, basename);
			if (mikser.config.cleanUrls && !S(destination).endsWith('index.html')) {
				destination = path.join(destination.replace('.html', ''), 'index.html');
			}
			if (info.meta) {
				if (info.meta.render === false) {
					return false;
				}
				if (info.meta && info.meta.layout == undefined) {
					return false;
				}		
			}
			return destination;
		}
		else {
			let destinationBase = mikser.config.outputFolder;
			file = path.normalize(file);
			// in case file is just file name
			if (file.indexOf(path.sep) === -1 ||
				file.split(path.sep).length === 2 && file.indexOf(path.sep) === 0) {
				return path.join(destinationBase, file);
			}
			// create absolute path for the comparison
			let absoluteSource = path.isAbsolute(file) ? file : (path.sep + file);
			if (absoluteSource.indexOf(mikser.options.workingFolder) === 0) {
				absoluteSource = absoluteSource.substr(mikser.options.workingFolder.length, absoluteSource.length);
			}

			let dirToCheck = path.join(mikser.options.workingFolder, absoluteSource.split(path.sep).slice(0,2).join(path.sep));
			let skip = 0;
			if (fs.existsSync(dirToCheck)) skip = 1;
			return path.join(destinationBase, absoluteSource.split(path.sep).slice(skip + 1).join(path.sep));
		}
	};

	manager.getUrl = function (destination) {
		let url;
		if (destination && destination.indexOf(mikser.config.outputFolder) === 0) {
			url = destination.substring(mikser.config.outputFolder.length).split(path.sep).join('/');
			if (mikser.config.cleanUrls && !S(url).endsWith('index.html')) {
				url = document.url.replace('.html', '/index.html');
			}
		}
		return url;
	}

	manager.getShare = function(destination) {
		let relativeBase = destination.replace(mikser.config.outputFolder, '');
		relativeBase = S(relativeBase).replaceAll('\\','/').s;
		for (let share of mikser.config.shared) {
			let normalizedShare = S(share).replaceAll('\\','/').ensureLeft('/').s;
			if (relativeBase.indexOf(normalizedShare) == 0) {
				return share;
			}
		}
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

		if (!mikser.generator.findEngine(layoutId)) return Promise.resolve();

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
				if (info.meta) delete info.meta.href;
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
						}, {
							concurrency: mikser.config.workers
						});
					})
					.then((result) => {
						console.log('Custom plugins:', result.length);
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