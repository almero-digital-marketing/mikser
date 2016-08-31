'use strict'
var nunjucks = require('nunjucks');

module.exports = function (mikser, context) {
	var loader = new nunjucks.FileSystemLoader(mikser.config.layoutsFolder, {watch: false});
	var env = new nunjucks.Environment(loader, {autoescape: false});
	env.addFilter('apply', () => undefined);

	if (context) {
		context.nunjucks = function (source, options) {
			source = mikser.utils.findSource(source);
			let template = fs.readFileSync(source, { encoding: 'utf8' });
			let result = env.renderString(template, options);
			return result;
		}
	} else {
		var cache = {}
		mikser.generator.engines.push({
			extensions: ['njk'],
			pattern: '**/*.njk',
			render: function(context) {
				try {
					if (context.layout && context.layout.template) {
						let cached = cache[context.layout._id];
						let template; 
						if (cached && cached.importDate.getTime() == context.layout.importDate.getTime()) {
							template = cached.template;
						} else {
							template = nunjucks.compile(context.layout.template, env, context.layout.source);
							cache[context.layout._id] = {
								importDate: context.layout.importDate,
								template: template
							}
						}
						return template.render(context);
					}
					return context.content;
				} catch (err) {
					delete cache[context.layout._id];
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