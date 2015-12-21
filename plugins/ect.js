'use strict'

var ECT = require('ect');
var path = require('path');

module.exports = function (mikser, context) {
	if (context) {
		context.ect = function (source, options) {
			source = mikser.manager.findSource(source);
			var renderer = ECT({ root : path.dirname(source) });
			return renderer.render(path.basename(source), options);
		}
	} else {
		mikser.generator.engines.push({
			pattern: '**/*.+(ect|eco)', 
			render: function(context) {
				var renderer = ECT({ root : { page: context.layout.template } });
				try {
					return renderer.render('page', context);
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