'use strict'

var Promise = require('bluebird');
var util = require('util');
var minimatch = require("minimatch");
var spawnargs = require('parse-spawn-args');
var spawn = require('child_process').spawn;
var exec = Promise.promisify(require('child_process').exec);
var S = require('string');
var path = require('path');
var fs = require('fs-extra-promise');
var StreamSplitter = require("stream-splitter");

module.exports = function(mikser) {
	var tools = {};
	var debug = mikser.debug('tools');

	function run(command) {
		console.log('Execute:', command);
		let WINDOWS = /win32/.test(process.platform);

		if (WINDOWS) {
			return mikser.emit('mikser.tools.run.start', {
				command: command
			}).then(() => {
				return exec(command).then((stdout, stderr) => {
					if (stdout) {
						mikser.emit('mikser.tools.run', {
							message: stdout,
							command: command
						});
					}
					if (stderr) {
						mikser.emit('mikser.tools.run', {
							message: stderr,
							command: command
						});
						console.log(stderr);
					}

					return mikser.emit('mikser.tools.run.finish', {
						command: command,
						code: 0
					});

				}).catch((err) => {
					mikser.diagnostics.log('error', 'Failed to start:', command, err);
					return mikser.emit('mikser.tools.run.finish', {
						command, command,
						code: err.code,
					});
				});
			});
		}
		else {
			let fullCommand = command;
			return new Promise((resolve, reject) => {
				let args = spawnargs.parse(command);
				command = args.shift();

				return mikser.emit('mikser.tools.run.start', {
					command: fullCommand
				}).then(() => {
					let child = spawn(command, args, { cwd: mikser.options.workingFolder });
					
					child.on('error', function(err) {
						reject(err);
					});

					child.stdout.on('data', function(data){
						process.stdout.write(data);
					});

					child.stderr.on('data', function(data){
						process.stderr.write(data);
					});

					let outSplitter = child.stdout.pipe(StreamSplitter('\n'));
					outSplitter.encoding = 'utf8';
					outSplitter.on('token', function(line){
						mikser.emit('mikser.tools.run', {
							command: fullCommand,
							message: line
						});
					});

					let errSplitter = child.stderr.pipe(StreamSplitter('\n'));
					errSplitter.encoding = 'utf8';
					errSplitter.on('token', function(line){
						mikser.emit('mikser.tools.run', {
							command: fullCommand,
							message: line
						});
					});

					child.on('exit', function(code, signal){
						resolve(code);
					});
				});
			}).then((code) => {
				return mikser.emit('mikser.tools.run.finish', {
					command: fullCommand,
					code: code
				});
			}).catch((err) => {
					mikser.diagnostics.log('error','Failed to start:', fullCommand, err);
					return mikser.emit('mikser.tools.run.finish', {
						command: fullCommand,
						code: err.code,
					});
			});
		}
	}

	tools.compile = function(file){
		let compilation = mikser.emit('mikser.tools.compile', file);
		let excplicit = false;
		if (mikser.config.compile) {
			for (let compile of mikser.config.compile) {
				let command = compile;
				let pattern = '**/*';
				let sync = compile.sync || false;
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
					file = S(file).replaceAll('\\','/').ensureLeft('/').s;
					if (minimatch(file, pattern) || file == '/') {
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
		return compilation.then(() => {
			return Promise.resolve(excplicit);
		});
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
					sync = exec('xcopy /eDy "' + sourceFolder +'\\*" "' + destinationFolder + '\\"');					
				} else {
					sync = exec('xcopy /eDyq "' + sourceFolder +'\\*" "' + destinationFolder + '\\"');					
				}
			}
			else {
				if (OSX) {
					if (mikser.options.debug) {
						sync = exec('rsync -av "' + sourceFolder + '/" "' + destinationFolder + '/"');
					} else {
						sync = exec('rsync -a "' + sourceFolder + '/" "' + destinationFolder + '/"');
					}
				}
				else {
					if (mikser.options.debug) {
						sync = exec('cp -Rufv "' + sourceFolder + '/." "' + destinationFolder + '"');
					} else {
						sync = exec('cp -Ruf "' + sourceFolder + '/." "' + destinationFolder + '"');
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