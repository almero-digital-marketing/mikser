'use strict'

var Promise = require('bluebird');
var util = require('util');
var minimatch = require("minimatch");
var S = require('string');
var path = require('path');
var fs = require('fs-extra-promise');
var spawnargs = require('parse-spawn-args');
var spawn = require('cross-spawn-promise');

module.exports = function(mikser) {
	var tools = {};
	var debug = mikser.debug('tools');

	function run(command, internal) {
		if (!internal || mikser.options.debug) console.log('Execute:', command);

		let fullCommand = command;
		let args = spawnargs.parse(command);
		command = args.shift();

		return mikser.emit('mikser.tools.run.start', {
			command: fullCommand
		}).then(() => {
			return spawn(command, args, {
				cwd: mikser.options.workingFolder,
				stdio: 'inherit'
			}).then((stdout) => {
				return mikser.emit('mikser.tools.run', {
					message: stdout,
					command: command
				}).then(() => {
					return mikser.emit('mikser.tools.run.finish', {
						command: command,
						code: 0
					});
				});
			}).catch((err) => {
				mikser.diagnostics.log('error', 'Failed to start:', command, err.stderr.toString());
				return mikser.emit('mikser.tools.run.finish', {
					command, command,
					code: err.exitStatus
				});
			});
		});
	}

	tools.startup = function() {
		let startupActions = mikser.emit('mikser.tools.startup');
		if (mikser.config.startup) {
			if (typeof mikser.config.startup == 'string') mikser.config.startup = [mikser.config.startup];
			for (let startup of mikser.config.startup) {
				let command = startup;
				let pattern = '**/*';
				let sync = startup.sync || false;
				if (typeof startup == 'string' && mikser.plugins[startup] && mikser.plugins[startup].startup) {
					return mikser.plugins[startup].startup();
				}
				if (startup.plugin) {
					return mikser.plugins[startup.plugin].startup(file);
				}
				if (startup.command) {
					command = startup.command;
				}

				startupActions = startupActions.then(() => {
					return run(command).then(() => {
						debug('Startup done', command);							
					});
				});
				startupActions = startupActions.then(() => {
					if (!sync) return;
					if (mikser.config.shared.length) {
						return Promise.map(mikser.config.shared, (replica) => {
							replica = path.join(mikser.config.outputFolder, replica);
							fs.ensureDirSync(replica);
							return mikser.tools.syncFolders(mikser.config.runtimeFilesFolder, replica);
						}, {concurrency: 1});
					} else {
						return mikser.tools.syncFolders(mikser.config.runtimeFilesFolder, mikser.config.outputFolder);
					}
				});
			}
		}
		return startupActions;
	}

	tools.compile = function(file){
		let compilation = mikser.emit('mikser.tools.compile', file);
		let excplicit = false;
		if (mikser.config.compile) {
			if (typeof mikser.config.compile == 'string') mikser.config.compile = [mikser.config.compile];
			for (let compile of mikser.config.compile) {
				let command = compile;
				let pattern = '**/*';
				let sync = compile.sync || false;
				if (typeof compile == 'string' && mikser.plugins[compile] && mikser.plugins[compile].compile) {
					return mikser.plugins[compile].compile(file);
				}
				if (compile.plugin) {
					return mikser.plugins[compile.plugin].compile(file);
				}
				if (compile.command) {
					command = compile.command;
				}
				if (compile.pattern) {
					pattern = compile.pattern;
				}
				else {
					if (S(command).contains('lessc')) {
						pattern = '**/*.less';
						if (compile.sync == undefined) sync = true;
					}
					else if (S(command).contains('sass')) {
						pattern = '**/*.{scss,sass}';
						if (compile.sync == undefined) sync = true;
					}
					else if (S(command).contains('coffee')) {
						pattern = '**/*.coffee';
						sync = true;
					}
					else if (S(command).contains('tsc')) {
						pattern = '**/*.ts';
						if (compile.sync == undefined) sync = true;
					}
					else if (S(command).contains('browserify') ||
						S(command).contains('babel')) {
						pattern = '**/*.js';
						if (compile.sync == undefined) sync = true;
					}
				}
				if (file) {
					let relativeFile = S(file).replace(mikser.config.filesFolder, '').replace(mikser.config.sharedFolder, '').replaceAll('\\','/').ensureLeft('/').s;
					if (minimatch(relativeFile, pattern) || relativeFile == '/') {
						if (pattern != '**/*') excplicit = true;
						compilation = compilation.then(() => {
							return run(command).then(() => {
								debug('Compilation done', command);							
							});
						});
					}
				}
				else {
					compilation = compilation.then(() => {
						return run(command).then(() => {
							debug('Compilation done', command);							
						});
					});
				}
				compilation = compilation.then(() => {
					if (!sync) return;
					tools.runtimeSync();
				});
			}
		}
		return compilation.then(() => {
			return Promise.resolve(excplicit);
		});
	}

	tools.runtimeSync = function() {
		if (mikser.config.shared.length) {
			return Promise.map(mikser.config.shared, (replica) => {
				replica = path.join(mikser.config.outputFolder, replica);
				fs.ensureDirSync(replica);
				return mikser.tools.syncFolders(mikser.config.runtimeFilesFolder, replica);
			}, {concurrency: 1});
		} else {
			return mikser.tools.syncFolders(mikser.config.runtimeFilesFolder, mikser.config.outputFolder);
		}
	}

	tools.syncFolders = function(sourceFolder, destinationFolder) {
		let WINDOWS = /win32/.test(process.platform);
		let OSX = /darwin/.test(process.platform);
		let CYGWIN = /cygwin/.test(process.env.PATH);
		let XCOPY = WINDOWS && !CYGWIN
		let sync = Promise.resolve();
		if (fs.existsSync(sourceFolder)) {
			fs.ensureDirSync(destinationFolder);
			if (XCOPY) {
				if (mikser.options.debug) {
					sync = run('xcopy "' + sourceFolder +'\\*" "' + destinationFolder + '\\" /E /D /-Y', true);					
				} else {
					sync = run('xcopy "' + sourceFolder +'\\*" "' + destinationFolder + '\\" /E /D /-Y /Q', true);					
				}
			}
			else {
				if (OSX) {
					if (mikser.options.debug) {
						sync = run('rsync -av "' + sourceFolder + '/" "' + destinationFolder + '/"', true);
					} else {
						sync = run('rsync -a "' + sourceFolder + '/" "' + destinationFolder + '/"', true);
					}
				}
				else {
					if (mikser.options.debug) {
						sync = run('cp -Rufv "' + sourceFolder + '/." "' + destinationFolder + '"', true);
					} else {
						sync = run('cp -Ruf "' + sourceFolder + '/." "' + destinationFolder + '"', true);
					}
				}
			}
		}
		return sync.then(() => {
			debug('Sync done', sourceFolder, '->', destinationFolder);
		});
	}

	tools.build = function(){
		let build = mikser.emit('mikser.tools.build');
		if (mikser.config.build) {
			if (typeof mikser.config.build == 'string') {
				build = build.then(() => {
					return run(mikser.config.build);
				});
			} else {
				for (let command of mikser.config.build) {
					build = build.then(() => {
						if (typeof command == 'string' && mikser.plugins[command] && mikser.plugins[command].build) {
							return mikser.plugins[command].build();
						}
						return run(command);
					});
				}
			}
		}
		return build.then(() => {
			debug('Build done');
		});
	}

	mikser.tools = tools;
	return Promise.resolve(mikser);
}