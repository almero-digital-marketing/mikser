'use strict'

var Promise = require('bluebird');
var using = Promise.using;
var path = require('path');
var glob = require('glob-promise');
var cluster = require('cluster');
var matter = require('gray-matter');
var extend = require('node.extend');
var _ = require('lodash');
var fs = require("fs-extra-promise");
var yaml = require('js-yaml');
var S = require('string');
var exec = Promise.promisify(require('child_process').exec);
var constants = require('./constants.js');
var minimatch = require("minimatch");
var Route = require('route-parser');

function init(mikser) {
	var filemanager = {};
	mikser.config = extend({
		documentsPattern: '**/*',
		layoutsPattern: '**/*',
		pluginsPattern: '**/*',
		configPattern: '**/*.+(yml|yaml|json|cson|toml)',
		shared: [],
		compile: [],
		routes: [],
		cleanUrls: false
	}, mikser.config);
	var debug = mikser.debug('filemanager');

	mikser.config.copyFolder = mikser.config.filesFolder;
	mikser.config.replicateFolder = mikser.config.sharedFolder;
	if (mikser.config.shared.length) {
		mikser.config.copyFolder = mikser.config.sharedFolder;
		mikser.config.replicateFolder = mikser.config.filesFolder;
	}

	filemanager.getInfo = function (file) {
		if (minimatch(file, mikser.config.configPattern)) {
			let matterStart = '---';
			let basename = path.basename(file);
			let sourceExt = path.extname(basename);
			switch (sourceExt) {
				case '.toml':
					matterStart += 'toml';
					break;
				case '.json':
					matterStart += 'json';
					break;
				case '.cson':
					matterStart += 'cson';
					break;
			}
			var info = matter(matterStart + '\n' + fs.readFileSync(file, {encoding:'utf8'}) + '\n---\n');
		} else {
			var info = matter.read(file);
		}

		let fileId = file
			.replace(mikser.config.documentsFolder,'')
			.replace(mikser.config.layoutsFolder,'');
		fileId = S(fileId).replaceAll('\\','/').ensureLeft('/').s;
		if (!info.data.href) {
			info.data.href = fileId;
		}
		if (!info.data.layout) {
			for (let entry of mikser.config.layouts) {
				if (minimatch(info.data.href, entry.pattern)) {
					info.data.layout = entry.layout;
					debug('Auto layout:', fileId, entry.layout);
				}
			}
		}

		for(let route of mikser.config.routes) {
			route = new Route(S(route).ensureLeft('/').s);
			let routeMeta = route.match(fileId);
			info.data = _.defaultsDeep(info.data, routeMeta);
		}

		return info;
	}

	filemanager.findSource = function (source) {
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

	filemanager.isPathToFile = function (destination) {
		let endingChar = destination.slice(-1);
		if (endingChar === '\\' || endingChar === '/') return false;
		if (fs.existsSync(destination) && fs.isDirectorySync(destination)) return false;
		let extName = path.extname(destination);
		// if this is not a directory or it is not ending on / || \, we check for file extension
		return (extName !== '' && extName !== '.');
	}

	filemanager.resolveDestination = function (destination, anchor) {
		let destinationFolder = path.dirname(anchor);
		let share = filemanager.getShare(anchor);
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

	filemanager.predictDestination = function (file) {
		// file is absolute path for root /home/user/path/to/file
		if (file.indexOf(mikser.config.documentsFolder) === 0 && 
			minimatch(file, mikser.config.documentsPattern)) {
			let info = filemanager.getInfo(file);
			if (info.data.destination && info.data.render !== false) {
				return path.join(mikser.config.outputFolder, info.data.destination);
			}
			// if current file is in documentsFolder, remove that path
			file = file.replace(mikser.config.documentsFolder, '').substring(1);
			let dir = path.dirname(file);
			let basename = path.basename(file);
			let sourceExt = path.extname(basename);
			let destinationExt = sourceExt;
			let fuzzyDestination = minimatch(file, mikser.config.configPattern);
			if (fuzzyDestination) {
				let multiExt = basename.split('.');
				multiExt.shift();
				if (multiExt.length == 1) {
					destinationExt = '.html';
				} 
				else {
					destinationExt = '.' + multiExt.shift();
				}
			}
			else {
				switch (sourceExt) {
					case '.md': 
						fuzzyDestination = true;
						destinationExt = '.html';
						break;
					default:
						destinationExt = sourceExt;
						break;
				}
			}

			basename = basename.substr(0, basename.indexOf(".")) + destinationExt;
			let destination = path.join(mikser.config.outputFolder, dir, basename);
			if (mikser.config.cleanUrls) {
				destination = path.join(destination.replace('.html', ''), 'index.html');
			}
			if (info.data) {
				if (info.data.render === false) {
					return false;
				}
				if (fuzzyDestination && info.data.layout == undefined) {
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

	filemanager.getUrl = function (destination) {
		let url;
		if (destination && destination.indexOf(mikser.config.outputFolder) === 0) {
			url = destination.substring(mikser.config.outputFolder.length).split(path.sep).join('/');
			if (mikser.config.cleanUrls && !S(url).endsWith('index.html')) {
				url = document.url.replace('.html', '/index.html');
			}
		}
		return url;
	}

	filemanager.getShare = function(destination) {
		destination = S(destination).replaceAll('\\','/').s;
		let relativeBase = destination.replace(mikser.config.outputFolder, '');
		for (let share of mikser.config.shared) {
			if (relativeBase.indexOf(S(share).replaceAll('\\','/').ensureLeft('/').s) == 0) {
			return share;
			}
		}
	}

	filemanager.importDocument = function (documentId, database) {
		documentId = S(documentId).replaceAll('\\','/').ensureLeft('/').s;
		let source = path.join(mikser.config.documentsFolder, documentId);
		let sourceStat = fs.statSync(source);
		if (sourceStat.isDirectory()) return Promise.resolve();

		let info = filemanager.getInfo(source);
		let destination = filemanager.predictDestination(source);
		let document = {
			_id: documentId, 
			stamp: mikser.stamp,
			importDate: new Date(),
			source: source,
			pageNumber: 0,
			meta: info.data,
			content: info.content,
			sourceExt: path.extname(path.basename(source)),
			mtime: sourceStat.mtime,
			atime: sourceStat.atime,
			ctime: sourceStat.ctime,
			birthtime: sourceStat.birthtime,
			size: sourceStat.size,
			destination: destination,
			url: filemanager.getUrl(destination),
		};
		if (document.destination) document.destinationExt = path.extname(path.basename(document.destination));
		if (document.url) document.relativeBase = mikser.runtime.findHref({document: document}, '/').link;

		mikser.emit('importDocument', document);
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
							let addToRenderQueue = recentDocument.importDate < sourceStat.mtime.getTime();
							// Delete destination if document used to have destination before but not any more.
							if (recentDocument.destination) {
								fs.removeSync(recentDocument.destination);
							}
							return Promise.resolve(addToRenderQueue);
						}
						return Promise.resolve(true);
					});					
				}
			};
			return ckeckForChanges().then((addToRenderQueue) => {
				return mikser.runtime.save(document).then(() => {
					return database.documents.save(document);
				}).then(() => {
					if (addToRenderQueue) {
						return mikser.renderqueue.enqueueDocument(documentId, constants.RENDER_STRATEGY_FULL);
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

	filemanager.importLayout = function (layoutId, database) {
		layoutId = S(layoutId).replaceAll('\\','/').ensureLeft('/').s;
		var source = path.join(mikser.config.layoutsFolder, layoutId);
		let sourceStat = fs.statSync(source);
		if (sourceStat.isDirectory()) return Promise.resolve();
		var addToRenderQueue = false;
		let inspect = (database) => {
			return database.layouts.findOne({_id: layoutId}).then((layout) => {
				if (layout) {
					addToRenderQueue = layout.importDate < sourceStat.mtime.getTime();
				} else {
					addToRenderQueue = true;					
				}
			}).then(() => {
				var info = filemanager.getInfo(source);
				let layout = {
					_id: layoutId,
					stamp: mikser.stamp, 
					importDate: new Date(),
					source: source,
					meta: info.data,
					template: info.content
				}
				mikser.emit('importLayout', layout);
				if (addToRenderQueue) {
					return database.layouts.save(layout).then(() => {
						return mikser.renderqueue.enqueueLayout(layoutId);
					});
				}
				return database.layouts.save(layout);
			});
		}
		if (!database) {
			return using(mikser.database.connect(), inspect);
		}
		inspect(database);
	}

	filemanager.importPlugin = function (pluginId, database) {
		pluginId = S(pluginId).replaceAll('\\','/').ensureLeft('/').s;
		var source = path.join(mikser.config.pluginsFolder, pluginId);
		let sourceStat = fs.statSync(source);
		if (sourceStat.isDirectory()) return Promise.resolve();
		var addToRenderQueue = false;
		let inspect = (database) => {
			return database.plugins.findOne({_id: pluginId}).then((plugin) => {
				if (plugin) {
					addToRenderQueue = plugin.importDate < sourceStat.mtime.getTime();
				} else {
					addToRenderQueue = true;					
				}
			}).then(() => {
				let plugin = {
					_id: pluginId,
					stamp: mikser.stamp,
					source: source,
					importDate: new Date()
				}
				if (addToRenderQueue) {
					return database.plugins.save(plugin).then(() => {
						return mikser.renderqueue.enqueuePlugin(pluginId);
					});
				}
				return database.plugins.save(plugin);
			});
		}
		if (!database) {
			return using(mikser.database.connect(), inspect);
		}
		inspect(database);
	}

	filemanager.deleteDocument = function (documentId) {
		documentId = S(documentId).replaceAll('\\','/').ensureLeft('/').s;
		console.log('Delete:', documentId);
		return using(mikser.database.connect(), (database) => {
			return database.documents.findOne({_id: documentId}).then((document) => {
				if (!document) Promise.resolve();
				mikser.emit('deleteDocument', document);
				mikser.runtime.remove(document);
				return mikser.runtime.cleanLinks(document, database).then(() => {
					return database.documents.remove({
						_id: documentId
					});
				}).then(() => {
					return mikser.runtime.followLinks(document, database, true);
				}).then(() => {
					if (document.destination) {
						return fs.remove(document.destination);
					}
					return Promise.resolve();
				});
			});
		});
	};

	filemanager.deleteLayout = function (layoutId) {
		layoutId = S(layoutId).replaceAll('\\','/').ensureLeft('/').s;
		console.log('Delete:', layoutId);
		return using(mikser.database.connect(), (database) => {
			return mikser.database.findLayout({_id: layoutId}).then((layout) => {
				if (!layout) Promise.resolve();
				mikser.emit('deleteLayout', layout);
				return mikser.renderqueue.enqueueLayout(layoutId).then(() => {
					return database.layouts.remove({
						_id: layoutId
					});
				});
			});
		});
	};

	filemanager.deletePlugin = function (pluginId) {
		pluginId = S(pluginId).replaceAll('\\','/').ensureLeft('/').s;
		console.log('Delete:', pluginId);
		return mikser.renderqueue.enqueuePlugin(pluginId).then(() => {
			return using(mikser.database.connect(), (database) => {
				return database.plugins.remove({
					_id: pluginId
				});
			});
		});
	};

	if (cluster.isMaster) {
		filemanager.glob = function () {
			return using(mikser.database.connect(), (database) => {
				return Promise.resolve()
					.then(() => {
						return glob(mikser.config.documentsPattern, { cwd: mikser.config.documentsFolder });
					})
					.then((files) => {
						return Promise.map(files, (file) => {
							return filemanager.importDocument(file, database);
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
							return filemanager.importLayout(file, database);
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
							return filemanager.importPlugin(file, database);
						});
					})
					.then((result) => {
						console.log('Custom plugins:', result.length);
					});
			});
		};

		filemanager.clean = function () {
			return mikser.database.findDocuments({
				stamp: { $lt: mikser.stamp },
				pageNumber: 0
			}).then((documents) => {
				return Promise.map(documents, (document) => {
					return filemanager.deleteDocument(document._id);
				}, {concurrency: mikser.config.workers});
			}).then(() => {
				return mikser.database.findLayouts({stamp: { $lt: mikser.stamp }}).then((layouts) => {
					return Promise.map(layouts, (layout) => {
						return filemanager.deleteLayout(layout._id);
					}, {concurrency: mikser.config.workers});
				});
			}).then(() => {
				return mikser.database.findPlugins({stamp: { $lt: mikser.stamp }}).then((plugins) => {
					return Promise.map(plugins, (plugin) => {
						return filemanager.deletePlugin(plugin._id);
					}, {concurrency: mikser.config.workers});
				});
			}).then(() => {
				return Promise.resolve();
			});
		};

		filemanager.copy = function() {
			let WINDOWS = /win32/.test(process.platform);
			let OSX = /darwin/.test(process.platform);
			let CYGWIN = /cygwin/.test(process.env.PATH);
			let XCOPY = WINDOWS && !CYGWIN

			let commands = fs.ensureDirAsync(mikser.config.outputFolder);
			if (fs.existsSync(mikser.config.copyFolder)) {
				console.log('Copy files');
				if (XCOPY) {
					commands = commands.then(() => {
						return exec('xcopy /eDyQ "' + mikser.config.copyFolder +'\\*" "' + mikser.config.outputFolder + '\\"');
					});
				}
				else {
					if (OSX) {
						commands = commands.then(() => {
							return exec('rsync -a "' + mikser.config.copyFolder + '/" "' + mikser.config.outputFolder + '/"');
						});
					}
					else {
						commands = commands.then(() => {
							return exec('cp -Ruf "' + mikser.config.copyFolder + '/." "' + mikser.config.outputFolder + '"');
						});
					}
				}
			}

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
				console.log('Replicating')
				for(let replica of mikser.config.shared) {
					replica = path.join(mikser.config.outputFolder, replica);
					fs.ensureDirSync(replica);
					console.log('  ' + replica);
					if (XCOPY) {
						commands = commands.then(() => {
							return exec('xcopy /eDyQ "' + mikser.config.replicateFolder +'\\*" "' + replica + '\\"');
						});
					}
					else {
						if (OSX) {
							commands = commands.then(() => {
								return exec('rsync -a "' + mikser.config.replicateFolder + '/" "' + replica + '/"');
							});
						}
						else {
							commands = commands.then(() => {
								return exec('cp -Ruf "' + mikser.config.replicateFolder + '/." "' + replica + '"');	
							});
						}
					}
				}
			}					
			return commands;
		};

	}

	mikser.filemanager = filemanager;
	return fs.ensureDirAsync(mikser.config.filesFolder).then(() => {
		return fs.ensureDirAsync(mikser.config.outputFolder);
	}).then(() => {
		return fs.ensureDirAsync(mikser.config.documentsFolder);
	}).then(() => {
		return fs.ensureDirAsync(mikser.config.layoutsFolder);
	}).then(() => Promise.resolve(mikser));
}	
module.exports = init;