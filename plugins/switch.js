'use strict'

var router = require('express').Router();
var cluster = require('cluster');

module.exports = function(mikser) {

	let plugin = {
		toggleDebug: (state) => {
			mikser.options.debug = state;
			mikser.options.debugInclude = mikser.options.debugInclude || 'mikser';
			mikser.options.debugExclude = mikser.options.debugExclude || 'mikser';
		}
	}

	if (cluster.isWorker) return plugin;

	mikser.config.browser.push('switch');

	router.get('/watcher', (req, res) => {
		res.json({status: mikser.options.watch});
	});

	router.post('/watcher/:status?', (req, res) => {
		let status = !mikser.options.watch;
		if (req.params.status) {
			status = (req.params.status === 'true');
		}
		mikser.options.watch = status;
		if (status) {
			Promise.resolve()
				.then(mikser.tools.compile)
				.then(mikser.manager.sync)
				.then(mikser.manager.glob)
				.then(mikser.scheduler.process)
				.then((processed) => {
					if (!processed) {
						return mikser.tools.build();
					}
				})
				.then(mikser.watcher.start)
				.then(() => {
					res.send({status: mikser.options.watch});
				});
		} else {
			mikser.watcher.stop().then(() => {
				mikser.diagnostics.log('info', 'Watcher: ' + (mikser.options.watch ? 'enabled' : 'disabled'));
				res.send({status: mikser.options.watch});
			});
		}
	});

	router.get('/debug', (req, res) => {
		res.json({status: mikser.options.debug});
	});

	router.post('/debug/:status?', (req, res) => {
		let status = !mikser.options.debug;
		if (req.params.status) {
			status = (req.params.status === 'true');
		}
		mikser.broker.broadcast('mikser.plugins.switch.toggleDebug', status).then(() => {
			res.send({status: mikser.options.debug});
			mikser.diagnostics.log('info', 'Debug: ' + (mikser.options.debug ? 'enabled' : 'disabled'));
		});
	});

	mikser.on('mikser.server.listen', (app) => {
		app.use('/switch', router);
	});

	return plugin;
}