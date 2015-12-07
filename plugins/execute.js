'use strict';
let Promise = require('bluebird');
let execAsync = Promise.promisify(require('child_process').exec);
let execSync = require('child_process').execSync;
let extend = require('node.extend');
let swig = require('swig');

module.exports = function (mikser, context) {
	let debug = mikser.debug('execute');
	context.execute = function (command, options) {

		let config = extend({}, mikser.options.execute);

		if (!command) return;

		let defaultOptions = {
			async: false,
		};

		options = extend({}, defaultOptions, options);
		if (config[command]) {
			command = config[command];
		} else {
			command = swig.render(command, {locals: context});
		}

		debug(command, 'async:', options.async);
		if (!options.async) {
			try {
				mikser.diagnostics.log(context, 'info', `[execute] ${command}`);
				return execSync(command, {cwd: process.cwd(), encoding: 'utf8'});
			} catch (err) {
				let err = new Error('Execute command failed\n' + err);
				err.origin = 'excute';
				throw err;
			}
		} else {
			context.pending = context.pending.then(() => {
				mikser.diagnostics.log(context, 'info', `[execute] ${command}`);
				return execAsync(command, {cwd: process.cwd(), encoding: 'utf8'}).catch((err) => {
					mikser.diagnostics.log(context, 'error', `[execute] ${err}`);
				});
			});
		}
	}
}