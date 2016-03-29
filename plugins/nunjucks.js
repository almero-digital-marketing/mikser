'use strict'
var nunjucks = require('nunjucks');

module.exports = function (mikser, context) {
	var loader = new nunjucks.FileSystemLoader(mikser.config.layoutsFolder, {watch: false});
	var engine = new nunjucks.Environment(loader, {autoescape: false});

	if (context) {
		context.nunjucks = function (source, options) {
			source = mikser.manager.findSource(source);
			let template = fs.readFileSync(source, { encoding: 'utf8' });
			let result = engine.renderString(template, options);
			return result;
		}
	} else {
		mikser.generator.engines.push({
			pattern: '**/*.njk',
			render: function(context) {
				try {
					if (context.layout && context.layout.template) {
						let result = engine.renderString(context.layout.template, context);
						return result;
					}
				} catch (err) {
					let re = /\[Line\s(\d+)/;
					let result = re.exec(err.message);
					if (result) {
						let lineNumber = parseInt(result[1]) + 1;
						let diagnose = mikser.diagnostics.diagnose(context, lineNumber);
						diagnose.message = err.message.replace(re, '[Line ' + diagnose.lineNumber).replace('(unknown path) ', '');

						err = new Error('Render error');
						err.diagnose = diagnose;
						err.origin = 'nunjucks';
					}
					throw err;
				}
				console.log(result);
			}
		});
	}
};