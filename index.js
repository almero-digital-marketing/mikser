'use strict'

var cluster = require('cluster');
var Promise = require('bluebird');
var mikser = require('./lib/mikser');
var config = require('./lib/config');
var runtime = require('./lib/runtime');
var databse = require('./lib/database');
var loader = require('./lib/loader');
var generator = require('./lib/generator');
var scheduler = require('./lib/scheduler');
var manager = require('./lib/manager');
var watcher = require('./lib/watcher');
var diagnostics = require('./lib/diagnostics');
var server = require('./lib/server');
var tools = require('./lib/tools');
var debug = require('./lib/debug');
var broker = require('./lib/broker');
var parser = require('./lib/parser');
var _ = require('lodash');

module.exports.run = function(options) {
	mikser(options)
	.then(debug)
	.then(broker)
	.then(config)
	.then(runtime)
	.then(databse)
	.then(parser)
	.then(loader)
	.then(generator)
	.then(scheduler)
	.then(manager)
	.then(tools)
	.then(watcher)
	.then(server)
	.then(diagnostics)
	.then((mikser) => {
		if (cluster.isMaster) {
			console.log('Mikser: Loaded');
			mikser.loadPlugins().then(() => {
				mikser.cli.init(true);					
				mikser.debug.resetWatch()
				.then(mikser.manager.glob)
				.then(mikser.manager.clean)
				.then(mikser.tools.compile)
				.then(mikser.manager.copy)
				.then(mikser.server.listen)
				.then(mikser.scheduler.process)
				.then(mikser.server.refresh)
				.then(mikser.watcher.start)
				.then(() => {
					if (!mikser.options.server && !mikser.options.watch) {
						mikser.exit();
					}
				});
			});
		} else {
			mikser.loadPlugins().then(mikser.joinMaster);
		}
	});
};

