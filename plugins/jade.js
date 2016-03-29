'use strict'

var jade = require('jade');
var extend = require('node.extend');

module.exports = function (mikser, context) {
	if (context) {
		context.jade = function (source, options) {
			source = mikser.manager.findSource(source);
			return jade.renderFile(source, options);
		}		
	} else {
		var cache = {}
		mikser.generator.engines.push({
			pattern: '**/*.jade',
			render: function(context) {
				try {
					if (context.layout && context.layout.template) {
						let cached = cache[context.layout._id];
						let fn; 
						if (cached && cached.mtime == context.layout.mtime) {
							fn = cached.fn;
						} else {
							fn = jade.compile(context.layout.template, {
								filename: context.layout.source,
								cache: false
							});
							cache[context.layout._id] = {
								mtime: context.layout.mtime,
								fn: fn
							}
						}
						return fn(context);
						// let options = extend({}, context);
						// options.cache = false;
						// return jade.render(context.layout.template, options);
					}
					return context.content;
				} catch (err) {
					let re = /(?:on line\s|Jade:)(\d+)/;
					let result = re.exec(err.message);
					if (result) {
						let lineNumber = parseInt(result[1]);
						let diagnose = mikser.diagnostics.diagnose(context, lineNumber);
						if (/on line\s\d+/.test(err.message)) {
							diagnose.message = err.message.replace(/on line\s\d+/, 'on line ' + diagnose.lineNumber);
						}
						else {
							diagnose.message = err.message + ' Line: ' + diagnose.lineNumber;
						}
						
						err = new Error('Render error');
						err.diagnose = diagnose;
						err.origin = 'jade';
					}
					throw err;
				}
			}
		});
	}
};