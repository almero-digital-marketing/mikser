'use strict'

var ECT = require('ect');
var path = require('path');

module.exports = function (mikser, context) {
	if (context) {
		context.ect = function (source, options) {
			source = mikser.utils.findSource(source);
			var renderer = ECT({ root : path.dirname(source) });
			return renderer.render(path.basename(source), options);
		}
	} else {
		var cache = {}
		mikser.generator.engines.push({
			extensions: ['ect','eco'],
			pattern: '**/*.+(ect|eco)', 
			render: function(context) {
				try {
					if (context.layout && context.layout.template) {
						let layoutName = context.layout.source;
						if (!context.layout.meta.externalMeta) {
							layoutName = 'layout';
						}
						let cached = cache[context.layout._id];
						let renderer; 
						if (cached && cached.importDate.getTime() == context.layout.importDate.getTime()) {
							renderer = cached.renderer;
						} else {
							if (context.layout.meta.externalMeta) {
								renderer = ECT({
									cache: true,
									root: path.dirname(context.layout.source)
								});
							} else {
								let root = {};
								root[layoutName] = context.layout.template;
								renderer = ECT({
									cache: true,
									root: root
								});
							}
							cache[context.layout._id] = {
								importDate: context.layout.importDate,
								renderer: renderer
							}
						}
						return renderer.render(layoutName, context);
					}
					return context.content;
				} catch (err) {
					let re = /on line\s(\d+)/;
					let result = re.exec(err.message);
					if (result) {
						let lineNumber = parseInt(result[1]);
						let diagnose = mikser.diagnostics.diagnose(context, lineNumber);
						diagnose.message = err.message.replace(re, 'on line ' + diagnose.lineNumber);

						err = new Error('Render error');
						err.diagnose = diagnose;
						err.origin = 'ect';
					}
					throw err;
				}
			}
		});
	}

}