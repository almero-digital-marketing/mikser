'use strict'

var Promise = require('bluebird');
var path = require('path');
var cluster = require('cluster');
var chokidar = require('chokidar');
var extend = require('node.extend');
var fs = require("fs-extra-promise");
var _ = require('lodash');

module.exports = function(mikser) {
	var filewatcher = {};
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
		filewatcher.render = function(action, actionId) {
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
		filewatcher.copy = function() {
			if (!copying) {
				if (copyingTimout) clearTimeout(copyingTimout);
				copyingTimout = setTimeout(() => {
					return mikser.filemanager.copy().then(() => {
						copying = false;
					});
				}, mikser.config.copyDelay);
			}
		};

		filewatcher.watch = function() {
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
						filewatcher.render(() => mikser.filemanager.importDocument(file), file);
					}
					else if (event == 'add') {
						let action = function() {
							return mikser.filemanager.importDocument(file).then(() => {
								return mikser.scheduler.enqueueAll();
							});
						}
						filewatcher.render(action, file);						
					}
					else if (event == 'unlink') {
						filewatcher.render(() => mikser.filemanager.deleteDocument(file), file);
					}
				};
				chokidar.watch(mikser.config.documentsPattern, { cwd: mikser.config.documentsFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', documentAction);
				console.log('Watching documents:', mikser.config.documentsFolder)

				let layoutAction = function(event, file) {
					console.log('Layout:', event, file);
					if (event == 'change' || event == 'add') {
						filewatcher.render(() => mikser.filemanager.importLayout(file), file);
					}
					if (event == 'unlink') {
						filewatcher.render(() => mikser.filemanager.deleteLayout(file), file);
					}
				};
				chokidar.watch(mikser.config.layoutsPattern, { cwd: mikser.config.layoutsFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', layoutAction);
				console.log('Watching layouts:', mikser.config.layoutsFolder);

				if (fs.existsSync(mikser.config.pluginsFolder)) {
					let pluginsAction = function(event, file) {
						console.log('Plugin:', event, file);
						if (event == 'change' || event == 'add') {
							filewatcher.render(() => mikser.filemanager.importPlugin(file), file);
						}
						if (event == 'unlink') {
							filewatcher.render(() => mikser.filemanager.deletePlugin(file), file);
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
								filewatcher.copy(() => mikser);
							}
						});
					}
				};
				chokidar.watch(mikser.config.watcher.build, { cwd: mikser.config.filesFolder, ignoreInitial: true, ignored: /[\/\\]\./}).on('all', fileAction);
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

	mikser.filewatcher = filewatcher;
	return Promise.resolve(mikser);
}