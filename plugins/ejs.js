'use strict'

var ejs = require('ejs');
let fs = require('fs-extra');

module.exports = function (mikser, context) {
	if (context) {
		context.ejs = function (source, options) {
			source = mikser.manager.findSource(source);
			let template = fs.readFileSync(source, {
				encoding: 'utf8'
			});
			return ejs.render(template, options);
		}
	} else {
		mikser.generator.engines.push({
			pattern: '**/*.ejs',
			render: function(context) {
				try {
					if (context.layout && context.layout.template) {
						return ejs.render(context.layout.template, context);
					}
					return context.content;
				} catch (err) {
					let re = /(?:on line\s|ejs:)(\d+)/;
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
						err.origin = 'ejs';
					}
					throw err;
				}
			}
		});
	}
};