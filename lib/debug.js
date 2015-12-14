'use strict'
var Promise = require('bluebird');
var cluster = require('cluster');
var chalk = require('chalk');
var path = require('path');
var fs = require("fs-extra-promise");
var S = require('string');
var moment = require('moment');

function init(mikser) {
	var start = moment();

	mikser.debug = function(name) {
		return function() {
			let args = Array.from(arguments);
			let line = name + ' ' + args.join(' ');
			if ((mikser.options.debugInclude || mikser.options.debugExclude) && (
				(mikser.options.debugInclude == 'mikser' || mikser.options.debugInclude.indexOf(name) != -1) && 
				mikser.options.debugExclude.indexOf(name) == -1)) {
				let filter = path.join(mikser.config.runtimeFolder, 'debug');
				if (fs.existsSync(filter)) {
					filter = fs.readFileSync(filter, { encoding: 'utf8' });
					let any = false;
					for (let reg of S(filter).lines()) {
						if (S(reg).trim().s && line.match(new RegExp(reg))) {
							any = true;
							break;
						}
					}
					if (!any) return;
				}
				args.unshift(chalk.gray(moment().diff(start, 'seconds')));
				args.unshift(chalk.cyan(name));
				console.log.apply(null, args);
			}
		};
	}

	mikser.debug._resetWatch = function() {
		start = moment();
	}

	mikser.debug.resetWatch = function() {
		return mikser.broker.broadcast('mikser.debug._resetWatch');
	}

	if (cluster.isMaster) {
		mikser.cli
			.option('-d, --debug-include [names]', 'enables debug information based on comma-delimited module names')
			.option('-D, --debug-exclude [names]', 'desiables debug information based on comma-delimited module names')
			.init();
		if (mikser.cli.debugInclude === true) {
			mikser.options.debugInclude = 'mikser';
		}
		else if (typeof mikser.cli.debugInclude !== 'boolean') {
			mikser.options.debugInclude = mikser.cli.debugInclude;
		}
		if (mikser.cli.debugExclude === true) {
			mikser.options.debugExclude = 'mikser';
		}
		else if (typeof mikser.cli.debugExclude != 'boolean') {
			mikser.options.debugExclude = mikser.cli.debugExclude;
		}
		if (mikser.options.debugExclude) {
			mikser.options.debugInclude = mikser.options.debugInclude || 'mikser';				
		}
		if (mikser.options.debugInclude) {
			mikser.options.debugExclude = mikser.options.debugExclude || 'mikser';				
		}
		if (mikser.options.debugInclude || mikser.options.debugExclude) {
			mikser.options.debug = true;
		}
	}
	return Promise.resolve(mikser);
}	
module.exports = init;