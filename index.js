'use strict'

var cluster = require('cluster');
var Promise = require('bluebird');
var mikser = require('./lib/mikser');
var config = require('./lib/config');
var runtime = require('./lib/runtime');
var databse = require('./lib/database');
var loader = require('./lib/loader');
var renderengine = require('./lib/renderengine');
var renderqueue = require('./lib/renderqueue');
var filemanager = require('./lib/filemanager');
var filewatcher = require('./lib/filewatcher');
var diagnostics = require('./lib/diagnostics');
var server = require('./lib/server');
var compilator = require('./lib/compilator');
var debug = require('./lib/debug');
var _ = require('lodash');

module.exports.run = function(options) {
	mikser(options)
		.then(debug)
		.then(config)
		.then(runtime)
		.then(databse)
		.then(loader)
		.then(renderengine)
		.then(renderqueue)
		.then(filemanager)
		.then(compilator)
		.then(filewatcher)
		.then(server)
		.then(diagnostics)
		.then((mikser) => {
			if (cluster.isMaster) {
				console.log('Mikser: Loaded');
				mikser.loadPlugins().then(() => {
					mikser.cli
						.option('-S, --no-server', 'don\'t run web server to access your generated website')
						.option('-W, --no-watch', 'don\'t watch your website for changes')
						.init(true);

					mikser.options = _.defaults({ 
						watch: mikser.cli.watch, 
						server: mikser.cli.server
					}, mikser.options);
					mikser.debug.resetWatch();
					mikser.filemanager.glob()
						.then(mikser.filemanager.clean)
						.then(mikser.compilator.compile)
						.then(mikser.filemanager.copy)
						.then(() => {
							if (mikser.options.server) {
								mikser.server.listen();
							}

							mikser.renderqueue.process().then(() => {
								if (mikser.options.watch) {
									mikser.filewatcher.watch();
								} 
								if (!mikser.options.server && !mikser.options.watch) {
									mikser.exit();
								}
							});
						});
				});
			} else {
				mikser.loadPlugins().then(mikser.joinMaster);
			}
		});
};

