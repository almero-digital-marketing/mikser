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

function init(mikser) {
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
		if (context.layout) {
			stripped.layout = {
				_id: context.layout._id
			};
		}
		return stripped;
	}

	diagnostics.splice = function(context) {
		if (cluster.isMaster) {
			if (context.document) {
				diagnostics.renderPipeline[context.document._id] = diagnostics.renderPipeline[context.document._id] || {};
				diagnostics.renderPipeline[context.document._id][context._id] = {
					status: constants.DIAGNOSTICS_NONE,
					context: context,
					log: []
				};				
			}
		} else {
			let call = mikser.broker.call('mikser.diagnostics.splice', stripContext(context));
			context.pending = context.pending.then(call);
		}
	}

	diagnostics.break = function(context) {
		if (cluster.isMaster) {
			if (context.document) {
				diagnostics.renderPipeline[context.document._id][context._id].status = constants.DIAGNOSTICS_FAIL;
			}
		} else {
			let call = mikser.broker.call('mikser.diagnostics.break', stripContext(context));
			context.pending = context.pending.then(call);
		}
	}

	diagnostics.diagnose = function(context, line) {
		let data = context.document.content;
		let dataFile = context.document.source;
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

	diagnostics.log = function(context, level, message) {
		if (cluster.isMaster) {
			if (context.document) {
				diagnostics.renderPipeline[context.document._id][context._id].flushed = false;
				if (level != 'info' && diagnostics.renderPipeline[context.document._id][context._id] != constants.DIAGNOSTICS_FAIL) {
					diagnostics.renderPipeline[context.document._id][context._id].status = constants.DIAGNOSTICS_NOTICE;
					debug(level, message);
				}
				diagnostics.renderPipeline[context.document._id][context._id].log.push({
					level: level,
					message: message,
					layout: context.layout,
					document: context.document
				});
			}	
		} else {
			let call = mikser.broker.call('mikser.diagnostics.log', stripContext(context), level, message);
			if (context.pending) {
				context.pending = context.pending.then(call);
			}
			return call;
		}
	}

	diagnostics.leave = function(context) {
		if (cluster.isMaster) {
			if (context.document) {
				if (diagnostics.renderPipeline[context.document._id][context._id].status == constants.DIAGNOSTICS_NONE) {
					diagnostics.renderPipeline[context.document._id][context._id].status = constants.DIAGNOSTICS_SUCCESS;
				}
			}
		} else {
			let call = mikser.broker.call('mikser.diagnostics.leave', stripContext(context));
			context.pending = context.pending.then(call);
		}
	}

	diagnostics.snapshot = function() {
		if (mikser.options.debug) {
			let memory = process.memoryUsage();
			debug('Memory[' + mikser.workerId + ']:', pretty(memory.rss));			
		}
	}

	if (cluster.isMaster) {
		diagnostics.renderPipeline = {};
		diagnostics.profile = {};

		mikser.cli
			.option('-c, --config', 'show config that contains every single configurable option')
			.init();
		if (mikser.cli.config) {
			console.log('Mikser configuration\n');
			console.log(yaml.dump(mikser.config));
		}

		diagnostics.start = function(documentId) {
			diagnostics.profile[documentId] = {
				start: new Date().getTime()
			};
		}

		diagnostics.end = function(documentId) {
			diagnostics.profile[documentId].end = new Date().getTime();
		}

		diagnostics.inspect = function(documentId) {			
			let daignose = '';
			let fullLog = [];
			let daignoseLog = [];
			let isInteresting = false;
			let isCritical = false;
			let isPotentialError = false;
			let lastLayout = undefined;
			let sameLayout = 0;
			for (let contextId in diagnostics.renderPipeline[documentId]) {
				let pipe = diagnostics.renderPipeline[documentId][contextId];
				if (pipe.status != constants.DIAGNOSTICS_NONE && 
					pipe.status != constants.DIAGNOSTICS_SUCCESS) {
					isPotentialError = true;
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
						daignoseLog.push(log);
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
					daignose += ' ' + prefix + ' ' + pipe.context.layout._id;
					if (sameLayout > 0) {
						daignose += '(' + sameLayout + ')'
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
					if (context.document) {
						daignose = prefix + ' ' + pipe.context.document._id;					
					} else {
						daignose = prefix + ' ' + documentId;						
					}
				}
			}
			if (isInteresting) {
				console.log(daignose);
				if (isCritical) daignoseLog = fullLog;
				lastLayout = undefined;
				for(let log of daignoseLog) {
					if (log.layout && log.layout._id != lastLayout) {
						lastLayout = log.layout._id;
						console.log('  ' + chalk.underline(lastLayout));
					}
					let message = log.message;
					if (log.level == 'info') {
						message = chalk.green('info:') + ' ' + log.message;
					}
					else if (log.level == 'warning') {
						message = chalk.yellow('warning:') + ' ' + log.message;
					}
					else if (log.level == 'error') {
						message = chalk.red('error:') + ' ' + log.message;
					}

					if (message.match(/>\s\d+|/)) {
						console.log('  ' + message);
					}
					else {
						console.log(indentString(message, ' ', 2));
					}
				}
			}
			if (!isPotentialError) {
				delete diagnostics.renderPipeline[documentId];
			}
			return isPotentialError;				
		}

		diagnostics.flush = function() {			
			let flushed = [];
			for (let documentId in diagnostics.renderPipeline) {
				let isPotentialError = diagnostics.inspect(documentId);
				if (isPotentialError) {
					flushed.push(documentId);
				}
			}
			diagnostics.profile = {};				
			diagnostics.renderPipeline = {};
			return flushed;
		}
	}
	mikser.diagnostics = diagnostics;
	return Promise.resolve(mikser);
}	
module.exports = init;