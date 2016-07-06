'use strict'
let Promise = require('bluebird');
let exec = Promise.promisify(require('child_process').exec);
let fs = require("fs-extra-promise");
let path = require('path');
let S = require('string');

module.exports = function (mikser, context) {
	let debug = mikser.debug('using');
	let using = [];
	if (context.layout.meta && context.layout.meta.use) {
		if (typeof context.layout.meta.use == 'string') using.push(context.layout.meta.use);
		else using = context.layout.meta.use;
	} else {
		return Promise.resolve();
	}
	using = using.filter((use) => {
		let packagePath = path.join(mikser.config.runtimeFolder, 'node_modules', use);
		if (fs.existsSync(packagePath)) {
			context[S(use).camelize().s] = require(packagePath);
			return false;
		} else {
			packagePath = path.join(mikser.options.workingFolder, 'node_modules', use);
			if (fs.existsSync(packagePath)) {
				context[S(use).camelize().s] = require(packagePath);
				return false;
			}
		}
		return true;
	});
	if (!using.length) return Promise.resolve();

	debug('Installing packages:', using);
	let npm = 'npm i --prefix ' + mikser.config.runtimeFolder + ' ' + using.join(' ');
	return exec(npm).then(() => {
		for (let use of using) {
			let packagePath = path.join(mikser.config.runtimeFolder, 'node_modules', use);
			context[use] = require(packagePath);
		}
	});
}