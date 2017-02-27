'use strict';
let Promise = require('bluebird');
let execAsync = Promise.promisify(require('child_process').exec);
let execSync = require('child_process').execSync;
let extend = require('node.extend');
let swig = require('swig-templates');

module.exports = function (mikser, context) {
	let debug = mikser.debug('execute');
	
	if (context) {
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
					err = new Error('Execute command failed\n' + err);
					err.origin = 'excute';
					throw err;
				}
			} else {
				context.process(() => {
					mikser.diagnostics.log(this, 'info', `[execute] ${command}`);
					return mikser.broker.call('mikser.plugins.execute.exec', command).catch((err) => {
						mikser.diagnostics.log(this, 'error', `[execute] ${err}`);
					});
				});
			}
		}
	} else {
		return {
			exec: (command) => {
				return execSync(command, {cwd: process.cwd(), encoding: 'utf8'});
			}
		}
	}
}