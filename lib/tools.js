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

module.exports = function(mikser) {
	var tools = {};
	var debug = mikser.debug('tools');

	function run(command) {
		console.log('Execute:', command);
		let WINDOWS = /win32/.test(process.platform);

		if (WINDOWS) {
			return exec(command).then((stdout, stderr) => {
				if (stderr) {
					console.log(stderr);
				}
			});
		}
		else {						
			return new Promise((resolve, reject) => {
				let args = spawnargs.parse(command);
				command = args.shift();
				let child = spawn(command, args, {
					cwd: mikser.options.workingFolder, 
					stdio: "inherit"
				});
				child.on('exit', function(code){
			    	resolve();
				});
			});
		}
	}

	tools.compile = function(file){
		let compilation = Promise.resolve();
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
					if (S(command).startsWith('lessc')) {
						pattern = '**/*.less';
						sync = true;
					}
					else if (S(command).startsWith('sass')) {
						pattern = '**/*.{scss,sass}';
						sync = true;
					}
					else if (S(command).startsWith('coffee')) {
						pattern = '**/*.coffee';
						sync = true;
					}
					else if (S(command).startsWith('tsc')) {
						pattern = '**/*.ts';
						sync = true;
					}
					else if (S(command).startsWith('browserify') ||
						S(command).startsWith('babel')) {
						pattern = '**/*.js';
						sync = true;
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
						for(let replica of mikser.config.shared) {
							replica = path.join(mikser.config.outputFolder, replica);
							fs.ensureDirSync(replica);
							return mikser.tools.syncFolders(mikser.config.runtimeFilesFolder, replica);
						}				
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
				sync = exec('xcopy /eDyQ "' + sourceFolder +'\\*" "' + destinationFolder + '\\"');
			}
			else {
				if (OSX) {
					sync = exec('rsync -a "' + sourceFolder + '/" "' + destinationFolder + '/"');
				}
				else {
					sync = exec('cp -Ruf "' + sourceFolder + '/." "' + destinationFolder + '"');
				}
			}
		}
		return sync.then(() => {
			debug('Sync done', sourceFolder, '->', destinationFolder);
		});
	}

	tools.build = function(){
		let build = Promise.resolve();
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