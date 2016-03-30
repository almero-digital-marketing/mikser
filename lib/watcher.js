'use strict'

var Promise = require('bluebird');
var path = require('path');
var cluster = require('cluster');
var chokidar = require('chokidar');
var extend = require('node.extend');
var fs = require("fs-extra-promise");
var _ = require('lodash');

module.exports = function(mikser) {
	var watcher = {
		watchers: {},
		outputStack: {}
	};
	_.defaultsDeep(mikser.config, {
		renderDelay: 1000,
		copyDelay: 3000,
		watcher: {
			output: ['**/*.jpeg', '**/*.jpg', '**/*.gif', '**/*.png', '**/*.svg'],
			reload: ['**/*.css', '**/*.js'],
			files: ['**/*'],
			build: ['**/*.js', '**/*.css', '**/*.less', '**/*.coffee', '**/*.scss', '**/*.sass', '**/*.ts']
		}
	});

	mikser.config.watcher.output = mikser.config.watcher.output.concat(mikser.config.watcher.reload.map((glob) => '!' + glob));
	mikser.config.watcher.files = mikser.config.watcher.files.concat(mikser.config.watcher.build.map((glob) => '!' + glob));
	var debug = mikser.debug('watcher');
	let plugged = true;

	if(cluster.isMaster) {
		mikser.cli
			.option('-W, --no-watch', 'don\'t watch your website for changes')
			.init();
		if (mikser.options.watch !== false) {
			mikser.options = _.defaults({ 
				watch: mikser.cli.watch, 
			}, mikser.options);			
		}

		let renderTimeout;
		let lastRenderId;
		function render(action, actionId) {
			if (renderTimeout && actionId && lastRenderId == actionId) clearTimeout(renderTimeout);
			lastRenderId = actionId;
			renderTimeout = setTimeout(() => {
				action().then(() => {
					return mikser.scheduler.process();
				});
			}, mikser.config.renderDelay);
		};
		
		let copying = false;
		let copyingTimout;
		function copy() {
			if (!copying) {
				if (copyingTimout) clearTimeout(copyingTimout);
				copyingTimout = setTimeout(() => {
					watcher.unplug().then(() => {
						return mikser.manager.sync().then(() => {
							return watcher.plug().then(() => {
								copying = false;								
							});
						});						
					});
				}, mikser.config.copyDelay);
			}
		};

		watcher.plug = function() {
			if (!plugged) {
				plugged = true;
				let pending = _.keys(watcher.outputStack);
				debug('Pending:', pending.length);
				return Promise.map(pending, (file) => {
					debug('Plugging:', file);
					return watcher.outputStack[file]().then(() => delete watcher.outputStack[file]);
				}).then(() => {
					if (_.keys(watcher.outputStack).length) return watcher.plug();
					watcher.outputStack = {};
					debug('Plugged');
				});
			}
			return Promise.resolve();
		}

		watcher.unplug = function() {
			plugged = false;
			debug('Unplugged')
			return Promise.resolve();
		}

		watcher.stop = function(name) {
			if (name) {
				if (watcher.watchers[name]) {
					console.log('Stop watching:', name);
					watcher.watchers[name].close();
					delete watcher.watchers[name];						
				}
			} else {
				for(let key in watcher.watchers) {
					console.log('Stop watching:', key);
					watcher.watchers[key].close();
					delete watcher.watchers[key];
				}				
			}
			return Promise.resolve();
		}

		let outputAction = function(event, file) {
			let action = () => {
				return mikser.emit('mikser.watcher.outputAction', event, file);
			};
			if (plugged) {
				return action();
			} else {
				debug('Sheduling:', file);
				watcher.outputStack[file] = action;
			}
		};

		let documentAction = function(event, file) {
			console.log('Document', event + ':', path.sep + file);
			return mikser.emit('mikser.watcher.documentAction', event, file).then(() => {
				if (event == 'change') {
					render(() => mikser.manager.importDocument(file), file);
				}
				else if (event == 'add') {
					let action = function() {
						return mikser.manager.importDocument(file).then(() => {
							return mikser.scheduler.scheduleAllDocuments();
						});
					}
					render(action, file);						
				}
				else if (event == 'unlink') {
					render(() => mikser.manager.deleteDocument(file), file);
				}
			});
		};

		let layoutAction = function(event, file) {
			console.log('Layout', event + ':', path.sep + file);
			return mikser.emit('mikser.watcher.layoutAction', event, file).then(() => {
				if (event == 'change' || event == 'add') {
					render(() => mikser.manager.importLayout(file), file);
				}
				if (event == 'unlink') {
					render(() => mikser.manager.deleteLayout(file), file);
				}
			});
		};

		let pluginsAction = function(event, file) {
			console.log('Plugin', event + ':', path.sep + file);
			return mikser.emit('mikser.watcher.pluginsAction', event, file).then(() => {
				if (event == 'change' || event == 'add') {
					render(() => mikser.manager.importPlugin(file), file);
				}
				if (event == 'unlink') {
					render(() => mikser.manager.deletePlugin(file), file);
				}
			});
		};

		let fileAction = function(event, file) {
			return mikser.emit('mikser.watcher.fileAction', event, file).then(() => {
				if (event == 'add' || event == 'change' || event == 'unlink') {
					console.log('File', event + ':', path.sep + file);
					return watcher.unplug().then(() => {
						return mikser.tools.compile(file).then((processed) => {
							return watcher.plug().then(() => {
								if (!processed) {
									copy(() => mikser);
								}								
							});
						});							
					});
				}
			});
		};

		watcher.start = function() {
			if (mikser.options.watch) {
				if (mikser.config.livereload) {
					if (mikser.config.watcher.reload && !watcher.watchers.reload) {
						let watcherReload = chokidar.watch(mikser.config.watcher.reload, { cwd: mikser.config.outputFolder, ignoreInitial: true})
						watcherReload.on('all', outputAction);
						watcher.watchers.reload = watcherReload;						
						console.log('Watching reload:', mikser.config.outputFolder);
					}

					if (mikser.config.watcher.output && !watcher.watchers.output) {
						let watcherOutput = chokidar.watch(mikser.config.watcher.output, { cwd: mikser.config.outputFolder, ignoreInitial: true, interval: 5007})
						watcherOutput.on('all', outputAction);
						watcher.watchers.output = watcherOutput;
						console.log('Watching output:', mikser.config.outputFolder);
					}
				}
				if (mikser.config.documentsPattern && !watcher.watchers.documents) {
					let watcherDocuments = chokidar.watch(mikser.config.documentsPattern, { cwd: mikser.config.documentsFolder, ignoreInitial: true, ignored: /[\/\\]\./})
					watcherDocuments.on('all', documentAction);
					watcher.watchers.documents =  watcherDocuments;
					console.log('Watching documents:', mikser.config.documentsFolder);
				}
				if (mikser.config.layoutsPattern && !watcher.watchers.layouts) {
					let watcherLayouts = chokidar.watch(mikser.config.layoutsPattern, { cwd: mikser.config.layoutsFolder, ignoreInitial: true, ignored: /[\/\\]\./})
					watcherLayouts.on('all', layoutAction);
					watcher.watchers.layouts = watcherLayouts;
					console.log('Watching layouts:', mikser.config.layoutsFolder);
				}

				if (mikser.config.pluginsPattern && fs.existsSync(mikser.config.pluginsFolder)) {
					if (!watcher.watchers.plugins) {
						let watcherPlugins = chokidar.watch(mikser.config.pluginsPattern, { cwd: mikser.config.pluginsFolder, ignoreInitial: true, ignored: /[\/\\]\./})
						watcherPlugins.on('all', pluginsAction);
						watcher.watchers.plugins = watcherPlugins;
						console.log('Watching plugins:', mikser.config.pluginsFolder);
					}
				}

				if (mikser.config.watcher.build && !watcher.watchers.buldFiles) {
					let watcherBuildFiles = chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.filesFolder, ignoreInitial: true, ignored: /[\/\\]\./})
					watcherBuildFiles.on('all', fileAction);
					watcher.watchers.buldFiles = watcherBuildFiles;
					console.log('Watching build files:', mikser.config.filesFolder);
				}

				if (mikser.config.watcher.build && !watcher.watchers.buildLayouts) {
					let watcherBuildLayouts = chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.layoutsFolder, ignoreInitial: true, ignored: /[\/\\]\./})
					watcherBuildLayouts.on('all', fileAction);
					watcher.watchers.buildLayouts = watcherBuildLayouts;
					console.log('Watching build layouts:', mikser.config.filesFolder);
				}
				
				if (mikser.config.watcher.files && !watcher.watchers.files) {
					let watcherFiles = chokidar.watch(mikser.config.watcher.files, { cwd: mikser.config.filesFolder, interval: 5007, ignoreInitial: true, ignored: /[\/\\]\./})
					watcherFiles.on('all', fileAction);
					watcher.watchers.files = watcherFiles;
					console.log('Watching files:', mikser.config.filesFolder);
				}

				if (fs.existsSync(mikser.config.sharedFolder)) {
					if (mikser.config.watcher.build && !watcher.watchers.buildShared) {
						let watcherBuildShared = chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.sharedFolder, ignoreInitial: true, ignored: /[\/\\]\./})
						watcherBuildShared.on('all', fileAction);
						watcher.watchers.buildShared = watcherBuildShared;
						console.log('Watching build shared:', mikser.config.sharedFolder);
					}

					if (mikser.config.watcher.files && !watcher.watchers.sharedFolder) {
						let watcherShared = chokidar.watch(mikser.config.watcher.files, { cwd: mikser.config.sharedFolder, ignoreInitial: true, interval: 5007, ignored: /[\/\\]\./})
						watcherShared.on('all', fileAction);
						watcher.watchers.shared = watcherShared;
						console.log('Watching shared:', mikser.config.sharedFolder);
					}
				}
			}
			return Promise.resolve();
		};
	}

	mikser.watcher = watcher;
	return Promise.resolve(mikser);
}