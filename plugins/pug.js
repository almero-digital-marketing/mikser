'use strict'

var pug = require('pug');
var extend = require('node.extend');

module.exports = function (mikser, context) {
	let debug = mikser.debug('pug');
	if (context) {
		context.pug = context.jade = function (source, options) {
			source = mikser.utils.findSource(source);
			return pug.renderFile(source, options);
		}		
	} else {
		var cache = {}
		mikser.generator.engines.push({
			pattern: '**/*.+(jade|pug)', 
			render: function(context) {
				try {
					let _href = context.href;
					context.href = function() {
						let args = Array.from(arguments);
						let found = _href.apply(null, args);
						found.toJSON = found.toString;
						return found;
					}
					if (context.layout && context.layout.template) {
						let cached = cache[context.layout._id];
						let fn; 
						if (cached && cached.importDate.getTime() == context.layout.importDate.getTime()) {
							fn = cached.fn;
						} else {
							fn = pug.compile(context.layout.template, {
								filename: context.layout.source,
								cache: false
							});
							cache[context.layout._id] = {
								importDate: context.layout.importDate,
								fn: fn
							}
						}
						return fn(context);
					}
					return context.content;
				} catch (err) {
					debug(err.message);
					delete cache[context.layout._id];
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
						err.origin = 'pug';
					}
					throw err;
				}
			}
		});
	}
};