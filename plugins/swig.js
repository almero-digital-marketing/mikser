'use strict'

var swig = require('swig');

module.exports = function (mikser, context) {
	if (context) {
		context.swig = function (source, options) {
			source = mikser.filemanager.findSource(source);
			return swig.renderFile(source, options);
		}
	} else {
		mikser.generator.engines.push({
			pattern: '**/*.swig',
			render: function(context) {
				try {
					return swig.render(context.layout.template, { locals: context });
				} catch (err) {
					let re = /on line\s(\d+)/;
					let result = re.exec(err.message);
					if (result) {
						let lineNumber = parseInt(result[1]);
						let diagnose = mikser.diagnostics.diagnose(context, lineNumber);
						diagnose.message = err.message.replace(re, 'on line ' + diagnose.lineNumber);

						err = new Error('Render error');
						err.diagnose = diagnose;
						err.origin = 'swig';
					}
					throw err;
				}
			}
		});
	}
};