'use strict'

var Promise = require('bluebird');
var path = require('path');
var extend = require('node.extend');
var cluster = require('cluster');
var S = require('string');
var fs = require("fs-extra-promise");
var Route = require('route-parser');
var chalk = require('chalk');
var indentString = require('indent-string');
var constants = require('./constants.js');
var yaml = require('js-yaml');
var pretty = require('prettysize');

module.exports = function(mikser) {
	var diagnostics = {};
	var debug = mikser.debug('diagnostics');

	let stripContext = function (context) {
		let stripped = {
			_id: context._id
		};
		if (context.document) {
			stripped.document = {
				_id: context.document._id
			}		
		}
		if (context.view) {
			stripped.view = {
				_id: context.view._id
			}		
		}
		if (context.entity) {
			stripped.entity = {
				_id: context.entity._id
			}		
		}
		if (context.layout) {
			stripped.layout = {
				_id: context.layout._id
			};
		}
		return stripped;
	}
	let bufferSize = 0;

	diagnostics.splice = function(context) {
		if (context.entity) {
			context.renderPipeline = context.renderPipeline || {};
			context.renderPipeline[context._id] = {
				status: constants.DIAGNOSTICS_NONE,
				context: stripContext(context),
				log: []
			};				
		}
	}

	diagnostics.break = function(context) {
		if (context.entity) {
			context.renderPipeline[context._id].status = constants.DIAGNOSTICS_FAIL;
		}
	}

	diagnostics.diagnose = function(context, line) {
		if (context.stategy == constants.RENDER_STRATEGY_PREVIEW) return Promise.resolve();
		let data = context.entity.content;
		let dataFile = context.entity.source;
		if (context.layout) {
			data = context.layout.template;
			dataFile = context.layout.source;
		}

		let dataLines = data.split('\n');
		let errorText = dataLines[line -1];
		let matches = 0;
		for (let i = 0; i < line -1; i++) {
			if (dataLines[i] === errorText) matches++;
		}

		let diagnoseInfo = {};
		let dataSource = fs.readFileSync(dataFile, 'utf8').split('\n');
		for (let i = 0; i < dataSource.length; i++) {
			if (dataSource[i] === errorText) {
				if (matches === 0) {
					diagnoseInfo.lineNumber = i + 1;
					diagnoseInfo.line = errorText;
					break;
				}
				matches--;
			}
		}

		let linesBefore = 2;
		let linesAfter = 2;
		let errorIndex = diagnoseInfo.lineNumber -1;
		diagnoseInfo.details = [];
		let padding = Math.min(diagnoseInfo.lineNumber + 2, dataSource.length).toString().length;

		function createSnipetLine (row, lineContent) {
			let matches = lineContent.match(/\t*/);
			if (matches) {
				let spaces = new Array(matches[0].length + 1).join('  ');
				lineContent = lineContent.replace(/\t*/, spaces);
			}
			return '  ' + S(row).padLeft(padding).s + '|' + lineContent;
		}

		let snipetLine;
		for (let i = errorIndex - linesBefore; i <= errorIndex + linesAfter; i++) {
			if (i >= 0 && i < dataSource.length) {
				snipetLine = createSnipetLine(i+1, dataSource[i]);
				if (i === errorIndex) snipetLine = snipetLine.replace(snipetLine[0], '>');
				diagnoseInfo.details.push(snipetLine);
			}
		}
		diagnoseInfo.details = diagnoseInfo.details.join('\n');
		return diagnoseInfo;
	}

	diagnostics.log = function() {
		let args = Array.from(arguments);
		if (!args[0]) args.shift();

		if (args[0].entity && args.length >= 3) {
			let context = args.shift()
			let snapshot = stripContext(context);
			let level = args.shift();
			let message = args.map((a) => {
				if (typeof a === 'object') {
					return yaml.dump(a);
				}
				else {
					return a.toString();
				}
			}).join(' ');
			if (level != 'info' && context.renderPipeline[context._id] != constants.DIAGNOSTICS_FAIL) {
				context.renderPipeline[context._id].status = constants.DIAGNOSTICS_NOTICE;
				debug(level, message);
			}
			let entityLog = {
				level: level,
				message: message,
				layout: snapshot.layout,
				entity: snapshot.entity
			};
			if (context.document) entityLog.document = snapshot.document;
			if (context.view) entityLog.view = snapshot.view;
			context.renderPipeline[context._id].log.push({
				level: level,
				message: message,
				layout: snapshot.layout,
				entity: snapshot.entity
			});
			mikser.emit('mikser.diagnostics.log', {
				level: level,
				message: message,
				layoutId: snapshot.layout ? snapshot.layout._id : undefined,
				entityId: snapshot.entity ? snapshot.entity._id : undefined
			});
		} else {
			let level;
			if (args.length > 1) {
				level = args.shift();
			}
			if (args.length == 1 && args[0].message) {
				let err = args[0];
				let diagnosed = false;
				if (err.diagnose) {
					diagnosed = mikser.diagnostics.inspect(err.diagnose);
					if (diagnosed) return;
				}
				var message = err.stack || err.message;
			} else {
				var message = args.join(' ');			
			}
			mikser.emit('mikser.diagnostics.log', {
				message: message,
				level: level
			});
			if (level == 'info') {
				message = chalk.green('info:') + ' ' + message;
			}
			else if (level == 'warning') {
				message = chalk.yellow('warning:') + ' ' + message;
			}
			else if (level == 'error') {
				message = chalk.red('error:') + ' ' + message;
			}
			console.log(S(message).padRight(Math.max(bufferSize, message.length)).s);
			bufferSize = message.length;
		}
		return Promise.resolve();
	}

	diagnostics.progress = function() {
		let args = Array.from(arguments);
		let message = args.join(' ');
		mikser.emit('mikser.diagnostics.progress', message);
		process.stdout.write(
			S(message).padRight(Math.max(bufferSize, message.length)) + '\x1b[0G');
		bufferSize = message.length;
	}

	diagnostics.leave = function(context) {
		if (context.entity) {
			if (context.renderPipeline[context._id].status == constants.DIAGNOSTICS_NONE) {
				context.renderPipeline[context._id].status = constants.DIAGNOSTICS_SUCCESS;
			}
		}
	}

	diagnostics.snapshot = function() {
		if (mikser.options.debug) {
			let memory = process.memoryUsage();
			if (cluster.isMaster) {
				debug('Memory:', pretty(memory.rss));			
			} else {
				debug('Memory[' + mikser.workerId + ']:', pretty(memory.rss));			
			}
		}
	}

	diagnostics.inspect = function(renderPipeline) {			
		let diagnose = '';
		let diagnoseIndex = 0;
		let fullLog = [];
		let diagnoseLog = [];
		let isInteresting = false;
		let isCritical = false;
		let potentialError = false;
		let lastLayout = undefined;
		let sameLayout = 0;
		for (let contextId in renderPipeline) {
			let pipe = renderPipeline[contextId];
			if (pipe.status != constants.DIAGNOSTICS_NONE && 
				pipe.status != constants.DIAGNOSTICS_SUCCESS &&
				potentialError != constants.DIAGNOSTICS_FAIL) {
				potentialError = pipe.status;
			}
			if (pipe.skip) continue;
			pipe.skip = true;
			if (!isInteresting && 
				pipe.status != constants.DIAGNOSTICS_NONE && 
				pipe.status != constants.DIAGNOSTICS_SUCCESS) {
				isInteresting = true;
			}
			if (pipe.status == -1) {
				isCritical = true
			}
			for (let log of pipe.log) {
				fullLog.push(log);
				if (log.level != 'info') {
					diagnoseLog.push(log);
				}
			}

			let prefix = '•';
			if (pipe.context.layout) {
				if (lastLayout == pipe.context.layout._id) sameLayout++;
				else sameLayout = 0;
				lastLayout = pipe.context.layout._id;

				if (pipe.status == constants.DIAGNOSTICS_SUCCESS) {
					if (chalk.supportsColor) prefix = chalk.green('▪');
					else prefix = '▫';
				}
				else if (pipe.status == constants.DIAGNOSTICS_FAIL) {
					prefix = chalk.red('▪');
				}
				else if (pipe.status == constants.DIAGNOSTICS_NOTICE) {
					prefix = chalk.yellow('▪');
				}
				diagnose += ' ' + prefix + ' ' + pipe.context.layout._id;
				if (sameLayout > 0) {
					diagnose += '(' + sameLayout + ')'
				}
			}
			else {
				if (pipe.status == constants.DIAGNOSTICS_SUCCESS) {
					if (chalk.supportsColor) prefix = chalk.green('▸');
					else prefix = '▹';
				}
				else if (pipe.status == constants.DIAGNOSTICS_FAIL) {
					prefix = chalk.red('▸');
				}
				else if (pipe.status == constants.DIAGNOSTICS_NOTICE) {
					prefix = chalk.yellow('▸');
				}
				if (pipe.context.entity) {
					diagnose = prefix + ' ' + pipe.context.entity._id;					
				} else {
					diagnose = prefix + ' ' + entityId;						
				}
			}

			if (pipe.status != constants.DIAGNOSTICS_NONE && 
				pipe.status != constants.DIAGNOSTICS_SUCCESS) {
				diagnoseIndex = diagnose.length;
			}
		}
		if (isInteresting) {
			if (diagnoseIndex) {
				console.log(diagnose.substring(0, diagnoseIndex));
			}
			if (isCritical) diagnoseLog = fullLog;
			lastLayout = undefined;
			for(let log of diagnoseLog) {
				if (log.layout && log.layout._id != lastLayout) {
					lastLayout = log.layout._id;
					console.log('  ' + chalk.underline(lastLayout));
				}
				let message = log.message;
				let lines = message.split('\n');
				let firstLine = lines.shift();
				if (lines.length) {
					message = firstLine + '\n' + indentString(lines.join('\n'), 2, ' ');
				}
				if (log.level == 'info') {
					message = chalk.green('info:') + ' ' + message;
				}
				else if (log.level == 'warning') {
					message = chalk.yellow('warning:') + ' ' + message;
				}
				else if (log.level == 'error') {
					message = chalk.red('error:') + ' ' + message;
				}

				if (message.match(/>\s\d+|/)) {
					console.log('  ' + message);
				}
				else {
					console.log(indentString(message, 2, ' '));
				}
			}
		}
		return potentialError;				
	}

	if (cluster.isMaster) {

		mikser.cli
			.option('-c, --config', 'show config that contains every single configurable option')
			.init();
		if (mikser.cli.config) {
			console.log('Mikser configuration\n');
			console.log(yaml.dump(mikser.config));
		}
	}
	mikser.diagnostics = diagnostics;
	return Promise.resolve(mikser);
}