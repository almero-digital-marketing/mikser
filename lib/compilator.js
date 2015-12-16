'use strict'

var Promise = require('bluebird');
var util = require('util');
var minimatch = require("minimatch");
var spawnargs = require('parse-spawn-args');
var spawn = require('child_process').spawn;
var exec = Promise.promisify(require('child_process').exec);
var S = require('string');

module.exports = function(mikser) {
	var compilator = {};

	function run(command) {
		console.log('Compile:', command);
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

	compilator.compile = function(file){
		let compilation = Promise.resolve();
		let excplicit = false;
		if (mikser.config.compile) {
			for (let compile of mikser.config.compile) {
				let command = compile;
				let pattern = '**/*';
				if (compile.command) {
					command = compile.command;
				}
				if (compile.pattern) {
					pattern = compile.pattern;
				}
				else {
					if (S(command).startsWith('lessc')) {
						pattern = '**/*.less';
					}
					else if (S(command).startsWith('sass')) {
						pattern = '**/*.{scss,sass}';
					}
					else if (S(command).startsWith('coffee')) {
						pattern = '**/*.coffee';
					}
					else if (S(command).startsWith('tsc')) {
						pattern = '**/*.ts';
					}
				}
				if (file) {
					file = S(file).replaceAll('\\','/').ensureLeft('/').s;
					console.log(file, pattern);
					if (minimatch(file, pattern)) {
						if (pattern != '**/*') excplicit = true;
						compilation = compilation.then(() => {
							return run(command);
						});
						break;
					}
				}
				else {
					compilation = compilation.then(() => {
						return run(command);
					});
				}					
			}
		}
		return compilation.then(() => {
			return Promise.resolve(excplicit);
		});
	}

	mikser.compilator = compilator;
	return Promise.resolve(mikser);
}