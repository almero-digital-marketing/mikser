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
		watchers: []
	};
	_.defaultsDeep(mikser.config, {
		renderDelay: 1000,
		copyDelay: 3000,
		watcher: {
			output: ['**/*.xml', '**/*.json', '**/*.jpeg', '**/*.jpg', '**/*.gif', '**/*.png', '**/*.svg'],
			reload: ['**/*.css', '**/*.js'],
			files: ['**/*'],
			build: ['**/*.js', '**/*.css', '**/*.less', '**/*.coffee', '**/*.scss', '**/*.sass', '**/*.ts']
		}
	});

	mikser.config.watcher.output = mikser.config.watcher.output.concat(mikser.config.watcher.reload.map((glob) => '!' + glob));
	mikser.config.watcher.files = mikser.config.watcher.files.concat(mikser.config.watcher.build.map((glob) => '!' + glob));

	if(cluster.isMaster) {
		mikser.cli
			.option('-W, --no-watch', 'don\'t watch your website for changes')
			.init();
		if (mikser.options.watch !== false) {
			mikser.options = _.defaults({ 
				watch: mikser.cli.watch, 
			}, mikser.options);			
		}

		var watching = false;

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
					return mikser.manager.copy().then(() => {
						copying = false;
					});
				}, mikser.config.copyDelay);
			}
		};

		watcher.stop = function() {
			if (watching) {
				for(let watch of watcher.watchers) {
					watch.close();
				}
				watcher.watchers = [];
			}
			return Promise.resolve();
		}

		watcher.start = function() {
			if (!watching && mikser.options.watch) {
				if (mikser.config.livereload) {
					let outputAction = function(event, file) {
						// console.log('Out:', event, file);
						mikser.server.reload(file);
					};
					let watcherReload = chokidar.watch(mikser.config.watcher.reload, { cwd: mikser.config.outputFolder, ignoreInitial: true})
					watcherReload.on('all', outputAction);
					watcher.watchers.push(watcherReload);
					let watcherOutput = chokidar.watch(mikser.config.watcher.output, { cwd: mikser.config.outputFolder, ignoreInitial: true, interval: 5007})
					watcherOutput.on('all', outputAction);
					watcher.watchers.push(watcherOutput);
					console.log('Watching output:', mikser.config.outputFolder);
				}

				let documentAction = function(event, file) {
					console.log('Document:', event, file);
					if (event == 'change') {
						render(() => mikser.manager.importDocument(file), file);
					}
					else if (event == 'add') {
						let action = function() {
							return mikser.manager.importDocument(file).then(() => {
								return mikser.scheduler.enqueueAll();
							});
						}
						render(action, file);						
					}
					else if (event == 'unlink') {
						render(() => mikser.manager.deleteDocument(file), file);
					}
				};
				let watcherDocuments = chokidar.watch(mikser.config.documentsPattern, { cwd: mikser.config.documentsFolder, ignoreInitial: true, ignored: /[\/\\]\./})
				watcherDocuments.on('all', documentAction);
				watcher.watchers.push(watcherDocuments);
				console.log('Watching documents:', mikser.config.documentsFolder)

				let layoutAction = function(event, file) {
					console.log('Layout:', event, file);
					if (event == 'change' || event == 'add') {
						render(() => mikser.manager.importLayout(file), file);
					}
					if (event == 'unlink') {
						render(() => mikser.manager.deleteLayout(file), file);
					}
				};
				let watcherLayouts = chokidar.watch(mikser.config.layoutsPattern, { cwd: mikser.config.layoutsFolder, ignoreInitial: true, ignored: /[\/\\]\./})
				watcherLayouts.on('all', layoutAction);
				watcher.watchers.push(watcherLayouts);
				console.log('Watching layouts:', mikser.config.layoutsFolder);

				if (fs.existsSync(mikser.config.pluginsFolder)) {
					let pluginsAction = function(event, file) {
						console.log('Plugin:', event, file);
						if (event == 'change' || event == 'add') {
							render(() => mikser.manager.importPlugin(file), file);
						}
						if (event == 'unlink') {
							render(() => mikser.manager.deletePlugin(file), file);
						}
					};
					let watcherPlugins = chokidar.watch(mikser.config.pluginsPattern, { cwd: mikser.config.pluginsFolder, ignoreInitial: true, ignored: /[\/\\]\./})
					watcherPlugins.on('all', pluginsAction);
					watcher.watchers.push(pluginsAction);
					console.log('Watching plugins:', mikser.config.pluginsFolder);
				}

				let fileAction = function(event, file) {
					if (event == 'add' || event == 'change' || event == 'unlink') {
						console.log('File:', event, file);
						mikser.tools.compile(file).then((processed) => {
							if (!processed) {
								copy(() => mikser);
							}
						});
					}
				};
				let watcherBuildFiles = chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.filesFolder, ignoreInitial: true, ignored: /[\/\\]\./})
				watcherBuildFiles.on('all', fileAction);
				watcher.watchers.push(watcherBuildFiles);
				let watcherBuildLayouts = chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.layoutsFolder, ignoreInitial: true, ignored: /[\/\\]\./})
				watcherBuildLayouts.on('all', fileAction);
				watcher.watchers.push(watcherBuildLayouts);
				
				let watcherFiles = chokidar.watch(mikser.config.watcher.files, { cwd: mikser.config.filesFolder, interval: 5007, ignoreInitial: true, ignored: /[\/\\]\./})
				watcherFiles.on('all', fileAction);
				watcher.watchers.push(watcherFiles);
				console.log('Watching files:', mikser.config.filesFolder);

				if (fs.existsSync(mikser.config.sharedFolder)) {
					let watcherBuildShared = chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.sharedFolder, ignoreInitial: true, ignored: /[\/\\]\./})
					watcherBuildShared.on('all', fileAction);
					watcher.watchers.push(watcherBuildShared);

					let watcherShared = chokidar.watch(mikser.config.watcher.files, { cwd: mikser.config.sharedFolder, ignoreInitial: true, interval: 5007, ignored: /[\/\\]\./})
					watcherShared.on('all', fileAction);
					watcher.watchers.push(watcherShared);
					console.log('Watching shared:', mikser.config.sharedFolder);
				}
				watching = true;
			}
			return Promise.resolve();
		};
	}

	mikser.watcher = watcher;
	return Promise.resolve(mikser);
}