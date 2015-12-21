'use strict'

var Promise = require('bluebird');
var path = require('path');
var cluster = require('cluster');
var chokidar = require('chokidar');
var extend = require('node.extend');
var fs = require("fs-extra-promise");
var _ = require('lodash');

module.exports = function(mikser) {
	var watcher = {};
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
		var watching = false;

		let renderTimeout;
		let lastRenderId;
		watcher.render = function(action, actionId) {
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
		watcher.copy = function() {
			if (!copying) {
				if (copyingTimout) clearTimeout(copyingTimout);
				copyingTimout = setTimeout(() => {
					return mikser.manager.copy().then(() => {
						copying = false;
					});
				}, mikser.config.copyDelay);
			}
		};

		watcher.watch = function() {
			if (!watching) {
				if (mikser.config.livereload) {
					let outputAction = function(event, file) {
						// console.log('Out:', event, file);
						mikser.server.reload(file);
					};
					chokidar.watch(mikser.config.watcher.reload, { cwd: mikser.config.outputFolder, ignoreInitial: true}).on('all', outputAction);
					chokidar.watch(mikser.config.watcher.output, { cwd: mikser.config.outputFolder, ignoreInitial: true, interval: 5007}).on('all', outputAction);
					console.log('Watching output:', mikser.config.outputFolder);
				}

				let documentAction = function(event, file) {
					console.log('Document:', event, file);
					if (event == 'change') {
						watcher.render(() => mikser.manager.importDocument(file), file);
					}
					else if (event == 'add') {
						let action = function() {
							return mikser.manager.importDocument(file).then(() => {
								return mikser.scheduler.enqueueAll();
							});
						}
						watcher.render(action, file);						
					}
					else if (event == 'unlink') {
						watcher.render(() => mikser.manager.deleteDocument(file), file);
					}
				};
				chokidar.watch(mikser.config.documentsPattern, { cwd: mikser.config.documentsFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', documentAction);
				console.log('Watching documents:', mikser.config.documentsFolder)

				let layoutAction = function(event, file) {
					console.log('Layout:', event, file);
					if (event == 'change' || event == 'add') {
						watcher.render(() => mikser.manager.importLayout(file), file);
					}
					if (event == 'unlink') {
						watcher.render(() => mikser.manager.deleteLayout(file), file);
					}
				};
				chokidar.watch(mikser.config.layoutsPattern, { cwd: mikser.config.layoutsFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', layoutAction);
				console.log('Watching layouts:', mikser.config.layoutsFolder);

				if (fs.existsSync(mikser.config.pluginsFolder)) {
					let pluginsAction = function(event, file) {
						console.log('Plugin:', event, file);
						if (event == 'change' || event == 'add') {
							watcher.render(() => mikser.manager.importPlugin(file), file);
						}
						if (event == 'unlink') {
							watcher.render(() => mikser.manager.deletePlugin(file), file);
						}
					};
					chokidar.watch(mikser.config.pluginsPattern, { cwd: mikser.config.pluginsFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', pluginsAction);
					console.log('Watching plugins:', mikser.config.pluginsFolder);
				}

				let fileAction = function(event, file) {
					if (event == 'add' || event == 'change' || event == 'unlink') {
						console.log('File:', event, file);
						mikser.compilator.compile(file).then((processed) => {
							if (!processed) {
								watcher.copy(() => mikser);
							}
						});
					}
				};
				chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.filesFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', fileAction);
				chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.layoutsFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', fileAction);
				
				chokidar.watch(mikser.config.watcher.files, { cwd: mikser.config.filesFolder, interval: 5007, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', fileAction);
				console.log('Watching files:', mikser.config.filesFolder);

				if (fs.existsSync(mikser.config.sharedFolder)) {
					chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.sharedFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', fileAction);
					chokidar.watch(mikser.config.watcher.files, { cwd: mikser.config.sharedFolder, ignoreInitial: true, interval: 5007, ignored: /[\/\\]\./}).on('all', fileAction);
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