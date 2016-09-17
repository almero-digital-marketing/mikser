'use strict'
var express = require('express');
var path = require('path');
var fs = require("fs-extra-promise");
var _ = require('lodash');
var Promise = require('bluebird');
var S = require('string');

module.exports = function (mikser) {
	var debug = mikser.debug('server-borwser');

	mikser.on('mikser.server.listen', (app) => {
		if (mikser.config.browser) {
			mikser.engine.inject = function(content, options) {
				options = options || {};
				if (content) {
					content = content.replace('<body', '<body data-mikser="' + S(JSON.stringify(options)).escapeHTML().s + '"');
					return content.replace('</body>','<script src="/mikser/bundle.js" async></script></body>');
				}
			}

			var browserify = require('browserify-middleware');

			let modules = _.uniq(mikser.config.browser).map((pluginName) => {
				let pluginModule = {};
				let browserPlugin = mikser.runtime.findBrowserPlugin(pluginName);

				let browserFolder = path.dirname(browserPlugin);
				debug('Browser folder:', browserFolder);
				if (browserFolder.indexOf('browser') > -1) {
					app.use('/mikser/' + pluginName, express.static(browserFolder));
				}

				pluginModule[browserPlugin] = {expose: pluginName};
				debug('Browser module[' + pluginName + ']:', browserPlugin);
				return pluginModule;
			});

			let runtimeBrowserConfig = path.join(mikser.config.runtimeFolder, 'browser', 'config.js');
			let config = 'module.exports = function(mikser) { mikser.config = ' + JSON.stringify(mikser.config) + '; return mikser;}';
			fs.outputFileSync(runtimeBrowserConfig, config);
			
			let configModule = {};
			configModule[runtimeBrowserConfig] = { expose: 'mikser-config' };
			modules.push(configModule);

			let mainModule = {};
			mainModule[path.join(__dirname, 'browser.js')] = {run: true};
			modules.push(mainModule);

			let browserifySettings = browserify.settings.production;
			if(mikser.options.debug || mikser.config.dev) {
				browserifySettings = browserify.settings.development;
			}

			app.use('/mikser/bundle.js', browserify(modules, browserifySettings));				
		}
	});	

}